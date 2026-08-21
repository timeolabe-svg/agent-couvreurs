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

  /**
   * ⚠️ RÉGLER LES DESTINATAIRES ICI — parce que le champ de l'écran Agent ÉCRASE la variable d'env.
   *
   * Constaté le 19/08 : le champ ne contenait que l'adresse de Haris, donc Timéo — qui est payé au
   * rendez-vous — n'était plus prévenu quand il y en avait un. C'est le piège du réglage d'interface
   * qui pilote la vraie config sans qu'on s'en rende compte : la variable d'environnement contenait
   * bien les deux adresses, elle n'était simplement plus lue.
   *
   * ?definir=a@x.fr,b@y.fr  → écrit la liste complète (remplace, ne complète pas).
   */
  const aDefinir = (req.nextUrl.searchParams.get('definir') ?? '').trim()
  if (aDefinir) {
    const liste = aDefinir.split(',').map(s => s.trim()).filter(s => s.includes('@'))
    if (liste.length === 0) {
      return NextResponse.json({ error: 'aucune adresse valide dans ?definir=' }, { status: 400 })
    }
    await sql`
      INSERT INTO agent_config (key, value, updated_at, updated_by)
      VALUES ('client_notif_email', ${liste.join(',')}, NOW(), 'admin')
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW(), updated_by = 'admin'
    `
    return NextResponse.json({
      ok: true,
      ancienne_liste: effectifs,
      nouvelle_liste: liste,
      lecture: 'Ces adresses recevront désormais TOUTES les notifications de rendez-vous.',
    })
  }

  // Les RDV récents ont-ils laissé une trace de notification ?
  const evts = (await sql`
    SELECT type, data, created_at FROM dashboard_events
    WHERE type IN ('rdv_created', 'reply_received')
      AND created_at > NOW() - INTERVAL '3 days'
    ORDER BY created_at DESC LIMIT 15
  `) as Array<{ type: string; data: Record<string, unknown>; created_at: string }>

  /**
   * ⚠️ TESTER LE VRAI CHEMIN, PAS UN AUTRE. Le cron test-notify passe par Resend, alors que les
   * notifications de rendez-vous partent par les BOÎTES GMAIL. Tester le mauvais canal donne une
   * réponse fausse dans les deux sens : « ça marche » alors que non, ou l'inverse.
   */
  let testGmail: Array<{ to: string; ok: boolean; erreur?: string }> | null = null
  if (req.nextUrl.searchParams.get('test') === '1') {
    const { getGmailBoxes, sendFromBox } = await import('@/lib/gmail-sender')
    const boxes = getGmailBoxes()
    testGmail = []
    for (const to of effectifs) {
      const r = await sendFromBox(boxes[0], {
        to,
        subject: 'Test notification agent Hdigiweb',
        text: [
          'Ceci est un test du canal de notification des rendez-vous.',
          'Si vous recevez ce message, les alertes de nouveau rendez-vous fonctionnent.',
        ].join('\n'),
        senderName: 'Agent Hdigiweb',
      }).catch((e: unknown) => ({ ok: false, error: String(e).slice(0, 150) }))
      testGmail.push({ to, ok: Boolean((r as { ok?: boolean }).ok), erreur: (r as { error?: string }).error })
    }
  }

  return NextResponse.json({
    test_canal_gmail: testGmail,
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
