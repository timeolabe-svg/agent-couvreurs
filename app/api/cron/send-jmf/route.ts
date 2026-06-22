import { NextRequest, NextResponse } from 'next/server'

// Envoi unique de la relance à JMF via Instantly v2 (test + envoi réel)
export async function GET(request: NextRequest) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const key = process.env.INSTANTLY_API_KEY
  const replyToUuid = '019ecae2-6538-72d8-be42-f63dcd11c8bd' // réponse JMF
  const eaccount = 'gabin@hdigiweb-agence.com'

  const text = `Bonjour,

Désolé pour le délai, j'étais en congés ces derniers jours et je n'ai pas pu vous rappeler comme prévu.

Votre retour m'a marqué : c'est précisément le profil d'entreprise pour lequel on obtient de bons résultats sur Tarbes, Pau et Lourdes. Avec votre réputation (4,7 sur Google), il y a vraiment de quoi capter plus de demandes de devis.

Je vous propose qu'on en parle 15 minutes au téléphone. Je peux vous appeler au 06 62 90 26 80 : vous préférez plutôt en début ou en fin de semaine ?

Dites-moi le moment qui vous arrange, je m'adapte à vous.

Bien à vous,

Gabin
Hdigiweb`

  const html = text.replace(/\n/g, '<br>')

  const out: Record<string, unknown> = {}
  try {
    const res = await fetch('https://api.instantly.ai/api/v2/emails/reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        reply_to_uuid: replyToUuid,
        eaccount,
        subject: 'Re: 8 à 15 devis de plus par mois, testable sans risque',
        body: { html, text },
      }),
    })
    out.status = res.status
    out.body = (await res.text()).slice(0, 600)
  } catch (e) {
    out.error = e instanceof Error ? e.message : String(e)
  }
  return NextResponse.json(out)
}
