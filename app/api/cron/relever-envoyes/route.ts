import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'
import { pingHeartbeat } from '@/lib/heartbeat'
import { getGmailBoxes } from '@/lib/gmail-sender'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * RELÈVE LE DOSSIER DES MESSAGES ENVOYÉS — pour savoir quand un HUMAIN a répondu.
 *
 * ⚠️ CE QUE ÇA RÉPARE. L'agent ne regardait que la boîte de réception. Quand Timéo répond à la main
 * depuis Gmail, son message part dans « Messages envoyés » et n'existe nulle part pour l'agent : ni
 * dans `email_queue`, ni dans `reply_drafts`. L'agent croit donc que personne n'a répondu, et il
 * écrit par-dessus.
 *
 * Le 25/08 sur Jaky Lesage : Timéo lui écrit qu'il l'appelle dans quelques minutes, l'agent
 * enchaîne deux messages sans rapport dont un rappel pour un créneau que le prospect venait de
 * refuser, et Timéo doit envoyer un mail d'excuse en prétendant s'être trompé de destinataire. Le
 * prospect a lu trois voix différentes sur le même fil.
 *
 * ⚠️ POURQUOI CE N'EST PAS DANS `poll-imap-replies`. Je l'y avais greffé d'abord. La lecture de la
 * liste des dossiers a fait tomber la connexion, et la boîte de RÉCEPTION est morte avec elle —
 * c'est-à-dire la fonction la plus critique du système, cassée par un ajout de confort. Un
 * traitement secondaire ne partage jamais la connexion d'un traitement vital : il prend la sienne,
 * et son échec ne coûte rien à personne.
 */

const BOITES_PAR_PASSAGE = 1
const FENETRE_HEURES = 48

export async function GET(req: NextRequest) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const boxes = getGmailBoxes()
  if (boxes.length === 0) return NextResponse.json({ ok: false, message: 'aucune boîte' })

  const { sql } = await import('@/lib/db')
  const { ImapFlow } = await import('imapflow')

  await sql`
    CREATE TABLE IF NOT EXISTS messages_humains (
      destinataire TEXT NOT NULL,
      envoye_le    TIMESTAMPTZ NOT NULL,
      sujet        TEXT,
      boite        TEXT,
      PRIMARY KEY (destinataire, envoye_le)
    )
  `.catch(() => {})
  await sql`CREATE INDEX IF NOT EXISTS idx_msg_humains_dest ON messages_humains (LOWER(destinataire), envoye_le DESC)`.catch(() => {})

  // Rotation persistante : même raison que pour le relevé des réponses, ne jamais dériver de l'horloge.
  const rot = (await sql`
    INSERT INTO agent_config (key, value, updated_at) VALUES ('envoyes_rotation', '1', now())
    ON CONFLICT (key) DO UPDATE SET value = ((COALESCE(NULLIF(agent_config.value, ''), '0')::bigint + 1))::text, updated_at = now()
    RETURNING value
  `.catch(() => [] as Array<{ value: string }>)) as Array<{ value: string }>
  const debut = Number(rot[0]?.value ?? 0) % boxes.length
  const aFaire = boxes.slice(debut).concat(boxes.slice(0, debut)).slice(0, BOITES_PAR_PASSAGE)

  const resultats: string[] = []
  let enregistres = 0

  for (const box of aFaire) {
    const client = new ImapFlow({
      host: 'imap.gmail.com', port: 993, secure: true,
      auth: { user: box.email, pass: box.password.replace(/\s+/g, '') },
      logger: false, socketTimeout: 15_000, greetingTimeout: 10_000, connectionTimeout: 10_000,
    })
    try {
      await client.connect()
      const listes = await client.list()
      /**
       * ⚠️ NE PAS DÉPENDRE D'UN SEUL INDICE. Le drapeau \Sent n'est pas toujours exposé, et sur
       * Gmail le dossier s'appelle « [Gmail]/Messages envoyés » ou « [Gmail]/Sent Mail » selon la
       * langue du compte. On essaie le drapeau, puis le nom, et on DIT ce qu'on n'a pas trouvé :
       * un échec silencieux laisse croire que le garde-fou veille alors qu'il ne voit rien.
       */
      const chemin = listes.find(m => m.specialUse === '\\Sent')?.path
        ?? listes.find(m => /sent|envoy/i.test(m.path))?.path
      if (!chemin) {
        resultats.push(`[${box.email}] dossier des envoyés introuvable parmi : ${listes.map(m => m.path).join(', ').slice(0, 160)}`)
        continue
      }

      const lock = await client.getMailboxLock(chemin)
      try {
        const depuis = new Date(Date.now() - FENETRE_HEURES * 3600 * 1000)
        const uids = (await client.search({ since: depuis })) as number[] | false
        const lignes: Array<{ dest: string; date: string; sujet: string }> = []
        for await (const msg of client.fetch(Array.isArray(uids) ? uids : [], { envelope: true })) {
          const env = msg.envelope
          const dest = (env?.to?.[0]?.address ?? '').toLowerCase()
          if (!dest) continue
          lignes.push({
            dest,
            date: (env?.date ?? new Date()).toISOString(),
            sujet: (env?.subject ?? '').slice(0, 200),
          })
        }
        /**
         * On enregistre TOUT ce qui est sorti, de l'agent comme de la main de Timéo. Ce qui compte
         * n'est pas QUI a écrit, mais « la dernière fois qu'un message est parti vers ce prospect ».
         * C'est cette date qui doit empêcher un second message dans la foulée.
         */
        for (let i = 0; i < lignes.length; i += 200) {
          const lot = lignes.slice(i, i + 200)
          await sql`
            INSERT INTO messages_humains (destinataire, envoye_le, sujet, boite)
            SELECT x.dest, x.date::timestamptz, x.sujet, ${box.email}
            FROM jsonb_to_recordset(${JSON.stringify(lot)}::jsonb) AS x(dest text, date text, sujet text)
            ON CONFLICT DO NOTHING
          `.catch(() => {})
          enregistres += lot.length
        }
        resultats.push(`[${box.email}] ${lignes.length} message(s) sortant(s) relevé(s) sur ${FENETRE_HEURES} h (dossier « ${chemin} »)`)
      } finally {
        lock.release()
      }
    } catch (e) {
      resultats.push(`[${box.email}] échec : ${String(e).slice(0, 120)}`)
    } finally {
      await client.logout().catch(() => { try { client.close() } catch { /* noop */ } })
    }
  }

  await pingHeartbeat('relever-envoyes', true, `enregistres=${enregistres}`, 120)
  return NextResponse.json({ ok: true, enregistres, resultats })
}
