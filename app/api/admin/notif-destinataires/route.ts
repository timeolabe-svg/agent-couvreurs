import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'

export const dynamic = 'force-dynamic'

/**
 * QUI REÇOIT RÉELLEMENT LES NOTIFICATIONS CLIENT ?
 *
 * ⚠️ La question « est-ce que Haris a été prévenu du rendez-vous ? » n'a aucune réponse lisible
 * aujourd'hui : les destinataires viennent SOIT du champ de l'écran Agent (agent_config), SOIT de
 * la variable d'environnement — et le premier écrase silencieusement le second. Un champ vidé par
 * inadvertance dans l'interface suffit donc à couper toutes les notifications, sans message
 * d'erreur, sans compteur, sans rien.
 *
 * On expose ici la valeur EFFECTIVE, celle qui sera vraiment utilisée, et d'où elle vient.
 */
export async function GET(req: NextRequest) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { sql } = await import('@/lib/db')

  let depuisUi: string[] = []
  try {
    const r = (await sql`SELECT value FROM agent_config WHERE key = 'client_notif_email' LIMIT 1`) as Array<{ value: string }>
    depuisUi = (r[0]?.value ?? '').split(',').map(s => s.trim()).filter(Boolean)
  } catch { /* clé absente */ }

  const depuisEnv = (process.env.CLIENT_NOTIFY_EMAIL ?? '')
    .split(',').map(s => s.trim()).filter(Boolean)

  const effectifs = depuisUi.length > 0 ? depuisUi : depuisEnv

  // Les RDV récents ont-ils laissé une trace de notification ?
  const evts = (await sql`
    SELECT type, data, created_at FROM dashboard_events
    WHERE type IN ('rdv_created', 'reply_received')
      AND created_at > NOW() - INTERVAL '3 days'
    ORDER BY created_at DESC LIMIT 15
  `) as Array<{ type: string; data: Record<string, unknown>; created_at: string }>

  return NextResponse.json({
    destinataires_effectifs: effectifs,
    source: depuisUi.length > 0 ? 'écran Agent (agent_config.client_notif_email)' : 'variable CLIENT_NOTIFY_EMAIL',
    depuis_ecran_agent: depuisUi,
    depuis_variable_env: depuisEnv,
    // ⚠️ Le point qui compte : une notification part via les boîtes Gmail. Si aucune n'est
    // configurée et que Resend n'a pas de clé, la fonction sort en silence sans rien envoyer.
    boites_gmail_configurees: (process.env.IMAP_ACCOUNTS ?? '').split(',').filter(Boolean).length,
    resend_configure: Boolean(process.env.RESEND_API_KEY),
    evenements_recents: evts.map(e => ({ type: e.type, quand: e.created_at, data: e.data })),
    lecture: effectifs.length === 0
      ? '⚠️ AUCUN destinataire : personne ne reçoit les notifications de rendez-vous.'
      : `Les notifications partent vers : ${effectifs.join(', ')}`,
  })
}
