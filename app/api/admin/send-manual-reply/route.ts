import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'
import { getGmailBoxes, sendFromBox } from '@/lib/gmail-sender'

/**
 * Envoi manuel ponctuel d'une réponse (hors moteur automatique), pour un cas précis validé par Timéo.
 *
 * ⚠️ CE CHEMIN CONTOURNAIT TOUS LES GARDE-FOUS (26/08, signalé par la session Optimum).
 *
 * Il prenait une adresse et un texte, et postait. Pas de blocklist, pas de mention légale d'origine
 * des données, pas d'en-tête de désinscription. C'était le DERNIER chemin vers un prospect à ne rien
 * vérifier — et ce n'est pas une hypothèse : c'est par lui que j'ai écrit une excuse à un répondeur
 * automatique le 19/08. Le détecteur existait, cet endpoint ne l'appelait pas.
 *
 * La règle vaut pour tout ce qui sort : « manuel » qualifie qui décide, pas ce que la loi exige. Une
 * réponse à un prospect démarché reste de la prospection commerciale, quelle que soit la main qui
 * appuie sur le bouton.
 */
export async function POST(request: NextRequest) {
  const auth = checkCronAuth(request)
  if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { to, subject, body, fromEmail } = await request.json()
  if (!to || !subject || !body) return NextResponse.json({ error: 'missing to/subject/body' }, { status: 400 })

  /**
   * Blocklist en premier, et FAIL-CLOSED : si la liste est illisible, on n'envoie pas. Un envoi raté
   * sur un incident de base se rattrape ; écrire à quelqu'un qui a demandé l'arrêt, non.
   */
  try {
    const { sql } = await import('@/lib/db')
    const domaine = String(to).split('@')[1]?.toLowerCase() ?? ''
    const bloque = (await sql`
      SELECT 1 FROM blocklist b
      WHERE LOWER(b.email) = LOWER(${to})
         OR (b.domain IS NOT NULL AND b.domain <> '' AND (
              LOWER(b.domain) = ${domaine} OR ${domaine} LIKE '%.' || LOWER(b.domain)))
      LIMIT 1
    `) as unknown[]
    if (bloque.length > 0) {
      return NextResponse.json({ error: `destinataire blocklisté — envoi refusé (${to})` }, { status: 409 })
    }
  } catch (e) {
    return NextResponse.json(
      { error: `blocklist non vérifiable → envoi refusé (fail-closed) : ${String(e).slice(0, 120)}` },
      { status: 503 },
    )
  }

  const boxes = getGmailBoxes()
  const box = boxes.find(b => b.email.toLowerCase() === (fromEmail ?? '').toLowerCase()) ?? boxes[0]
  if (!box) return NextResponse.json({ error: 'no box available' }, { status: 500 })

  // Mention légale d'origine des données + désinscription en un clic, comme sur les deux autres
  // chemins d'envoi. La garde anti-empilement évite de doubler le bloc si l'appelant l'a déjà mis.
  const { blocLegalRgpd } = await import('@/lib/rgpd')
  const { creerJetonDesabo } = await import('@/lib/unsubscribe-token')
  const base = (process.env.PUBLIC_APP_URL || 'https://agent-couvreurs.vercel.app').replace(/\/+$/, '')
  const lienDesabo = `${base}/u/${creerJetonDesabo(to)}`

  let corpsFinal = String(body)
  if (!/coordonnées professionnelles proviennent/i.test(corpsFinal)) {
    corpsFinal = `${corpsFinal.trimEnd()}\n\n${blocLegalRgpd(lienDesabo)}`
  }

  const r = await sendFromBox(box, {
    to,
    subject,
    text: corpsFinal,
    senderName: 'Gabin',
    headers: {
      'List-Unsubscribe': `<${lienDesabo}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  })
  return NextResponse.json({ ok: r.ok, error: r.error, from: box.email, to })
}
