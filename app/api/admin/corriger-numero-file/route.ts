import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'
import { wrapCron } from '@/lib/cron-wrap'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * 🚨 REMPLACEMENT DU FAUX NUMÉRO DANS LES MAILS DÉJÀ EN FILE.
 *
 * ⚠️ CONSTAT 10/08/2026, par le contrôle d'invariants (A3). Corriger le réglage
 * `agence_telephone` ne suffit PAS : le corps de chaque mail est FIGÉ au moment où l'agent
 * l'écrit. Des centaines de mails générés avant le correctif portent donc encore
 * « 06 12 34 56 78 » — et ils continuaient de PARTIR (des envois horodatés du jour même,
 * postérieurs à la correction du réglage).
 *
 * C'est le piège classique d'une file d'attente : on croit avoir corrigé parce qu'on a corrigé la
 * SOURCE, alors que le stock déjà produit garde l'ancienne valeur. Toute correction de contenu
 * doit donc s'accompagner d'une reprise du stock.
 *
 * Périmètre volontairement étroit : on ne touche QUE les lignes non encore envoyées, et on ne
 * remplace QUE la suite de chiffres. Aucun autre mot du message n'est modifié.
 *
 * GET            → compte ce qui serait corrigé
 * GET ?apply=1   → applique
 */
const FAUX = ['06 12 34 56 78', '0612345678', '06.12.34.56.78', '06-12-34-56-78',
              '01 23 45 67 89', '0123456789', '06 45 45 45 45', '0645454545']

async function handler(req: NextRequest) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { sql } = await import('@/lib/db')
  const apply = req.nextUrl.searchParams.get('apply') === '1'

  // Le VRAI numéro vient des réglages — et on refuse d'agir s'il est lui-même un faux
  // (c'est exactement ce qui s'était produit : le réglage contenait le numéro d'exemple).
  const [reglage] = (await sql`SELECT value FROM agent_config WHERE key = 'agence_telephone' LIMIT 1`) as Array<{ value: string }>
  const vrai = (reglage?.value ?? '').trim()
  const chiffres = vrai.replace(/\D/g, '')
  if (!vrai || FAUX.some(f => f.replace(/\D/g, '') === chiffres)) {
    return NextResponse.json({
      ok: false,
      error: 'le réglage agence_telephone est vide ou contient lui-même un numéro d\'exemple — corriger le réglage AVANT de reprendre la file',
      valeur_actuelle: vrai || '(vide)',
    }, { status: 409 })
  }

  const [avant] = (await sql`
    SELECT COUNT(*)::int AS n FROM email_queue
    WHERE status IN ('queued', 'pending')
      AND body ~ '0(6[\\s.-]?12[\\s.-]?34[\\s.-]?56[\\s.-]?78|1[\\s.-]?23[\\s.-]?45[\\s.-]?67[\\s.-]?89|6[\\s.-]?45[\\s.-]?45[\\s.-]?45[\\s.-]?45)'
  `) as Array<{ n: number }>

  const [dejaPartis] = (await sql`
    SELECT COUNT(*)::int AS n FROM email_queue
    WHERE status = 'sent'
      AND body ~ '0(6[\\s.-]?12[\\s.-]?34[\\s.-]?56[\\s.-]?78|1[\\s.-]?23[\\s.-]?45[\\s.-]?67[\\s.-]?89|6[\\s.-]?45[\\s.-]?45[\\s.-]?45[\\s.-]?45)'
  `) as Array<{ n: number }>

  if (!apply) {
    return NextResponse.json({
      ok: true, mode: 'constat', vrai_numero: vrai,
      a_corriger_en_file: avant?.n ?? 0,
      deja_envoyes_avec_le_faux: dejaPartis?.n ?? 0,
      note: 'Les mails déjà partis sont irréversibles ; seuls ceux en file peuvent être corrigés.',
    })
  }

  // Remplacement de TOUTES les écritures possibles du faux numéro, dans le corps ET le sujet.
  let corriges = 0
  for (const f of FAUX) {
    const r = (await sql`
      UPDATE email_queue SET body = REPLACE(body, ${f}, ${vrai})
      WHERE status IN ('queued', 'pending') AND body LIKE ${'%' + f + '%'}
      RETURNING id
    `) as Array<{ id: string }>
    corriges += r.length
  }

  const [reste] = (await sql`
    SELECT COUNT(*)::int AS n FROM email_queue
    WHERE status IN ('queued', 'pending')
      AND body ~ '0(6[\\s.-]?12[\\s.-]?34[\\s.-]?56[\\s.-]?78|1[\\s.-]?23[\\s.-]?45[\\s.-]?67[\\s.-]?89|6[\\s.-]?45[\\s.-]?45[\\s.-]?45[\\s.-]?45)'
  `) as Array<{ n: number }>

  return NextResponse.json({
    ok: true, mode: 'appliqué', vrai_numero: vrai,
    lignes_corrigees: corriges,
    reste_en_file: reste?.n ?? 0,
    deja_envoyes_avec_le_faux: dejaPartis?.n ?? 0,
  })
}

export const GET = wrapCron('corriger-numero-file', handler)
