import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'
import { wrapCron } from '@/lib/cron-wrap'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * BILAN QUOTIDIEN : NOUVEAUX CONTACTS vs RELANCES.
 *
 * ⚠️ Cette vue n'existait pas, et c'est précisément la question que Timéo pose — il facture au
 * résultat, donc ce qui compte est le nombre de PERSONNES NOUVELLEMENT démarchées, pas le volume
 * de mails. Le tableau de bord affichait « 126 mails aujourd'hui » sans dire que 123 étaient des
 * relances de prospects déjà connus : un chiffre exact qui donne une impression fausse.
 *
 * L'étape 0 est le premier contact. Les étapes 1 à 5 sont la séquence de relance. Les étapes >= 20
 * sont les relances de CONVERSATION (le prospect a déjà répondu puis s'est tu) — comptées à part,
 * parce qu'elles ne relèvent ni de la prospection froide ni de la séquence.
 */
async function handler(req: NextRequest) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const jours = Math.min(30, Math.max(1, Number(req.nextUrl.searchParams.get('jours') ?? 7)))
  const { sql } = await import('@/lib/db')

  const lignes = (await sql`
    SELECT sent_at::date AS jour,
           COUNT(*) FILTER (WHERE sequence_step = 0)::int                      AS nouveaux_contacts,
           COUNT(*) FILTER (WHERE sequence_step BETWEEN 1 AND 19)::int         AS relances_sequence,
           COUNT(*) FILTER (WHERE sequence_step >= 20)::int                    AS relances_conversation,
           COUNT(*)::int                                                        AS total,
           COUNT(DISTINCT contact_id)::int                                      AS personnes_touchees
    FROM email_queue
    WHERE status = 'sent' AND sent_at >= (CURRENT_DATE - ${jours}::int)
    GROUP BY sent_at::date
    ORDER BY jour DESC
  `) as Array<Record<string, unknown>>

  const total = lignes.reduce((acc, l) => ({
    nouveaux: acc.nouveaux + Number(l.nouveaux_contacts ?? 0),
    relances: acc.relances + Number(l.relances_sequence ?? 0),
    conversation: acc.conversation + Number(l.relances_conversation ?? 0),
    mails: acc.mails + Number(l.total ?? 0),
  }), { nouveaux: 0, relances: 0, conversation: 0, mails: 0 })

  return NextResponse.json({
    ok: true,
    periode_jours: jours,
    par_jour: lignes,
    cumul: total,
    lecture: 'nouveaux_contacts = personnes démarchées pour la première fois (étape 0). C\'est ce chiffre qui mesure la prospection ; le total de mails, lui, gonfle avec les relances.',
  })
}

export const GET = wrapCron('bilan-jour', handler)
