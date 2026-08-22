import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'
import { getGmailBoxes } from '@/lib/gmail-sender'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * BALAYAGE DE RATTRAPAGE — relit les QUATRE boîtes en profondeur pour retrouver les leads chauds
 * que le relevé courant n'a jamais vus.
 *
 * ⚠️ POURQUOI CE BALAYAGE EXISTE. Le relevé de production ne regarde qu'une fenêtre récente et une
 * ou deux boîtes par passage : c'est un compromis de budget, pas une garantie. Tout ce qui est
 * arrivé pendant une panne, ou plus ancien que la fenêtre, n'a jamais été lu par personne. Un
 * prospect qui écrit « rappelez-moi » dans une boîte que Timéo ne consulte pas sur son téléphone
 * n'existe alors nulle part.
 *
 * Ce point d'entrée ne dépend d'aucun budget de cron : il prend le temps qu'il faut, boîte par
 * boîte, sur une fenêtre longue.
 *
 *   ?boite=0..3   la boîte à balayer (obligatoire — une seule par appel, pour ne jamais être coupé)
 *   ?jours=30     la profondeur du balayage
 *   (défaut)      RAPPORT SEUL : rien n'est ingéré, rien n'est répondu
 *   ?ingerer=1    verse les messages inconnus dans la messagerie, SANS répondre à personne
 *
 * ⚠️ L'INGESTION NE RÉPOND JAMAIS TOUTE SEULE. Ces messages ont parfois plusieurs semaines : y
 * répondre automatiquement ferait partir des mails hors de propos, et sur des fils que Timéo a
 * peut-être déjà traités à la main. On les rend visibles, il décide.
 */

interface Trouvaille {
  boite: string
  de: string
  sujet: string
  recu_le: string
  chaud: boolean
  raison_chaud: string[]
  connu: boolean
  deja_en_base: boolean
  extrait: string
}

/**
 * Les marqueurs d'un lead chaud. Volontairement larges : le coût d'un faux positif est de lire un
 * message pour rien, le coût d'un faux négatif est un rendez-vous perdu.
 */
const MARQUEURS_CHAUD: Array<{ re: RegExp; quoi: string }> = [
  { re: /\b0[1-9]([ .\-]?\d{2}){4}\b/, quoi: 'laisse un numéro de téléphone' },
  { re: /rappel(ez|le|er)|appelez[- ]moi|appeler|joignable|tel\b|téléphone/i, quoi: 'demande à être appelé' },
  { re: /int[ée]ress|ça m'int[ée]resse|volontiers|pourquoi pas|d'accord|ok pour/i, quoi: 'exprime un intérêt' },
  { re: /rendez[- ]vous|rdv|dispo|disponible|cr[ée]neau|agenda|semaine prochaine|demain/i, quoi: 'parle de rendez-vous' },
  { re: /combien|tarif|prix|co[ûu]t|devis|budget/i, quoi: 'demande le prix' },
  { re: /comment [çc]a marche|en savoir plus|des pr[ée]cisions|expliquez/i, quoi: 'demande des précisions' },
]

/** Un message d'absence n'est pas un lead. Ne jamais confondre un robot et un prospect. */
const MARQUEURS_ABSENCE = /absent|cong[ée]s|vacances|ferm[ée]ture|fermé pour|réouverture|out of office|indisponible jusqu|ne sera ni lu/i

export async function GET(req: NextRequest) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const boxes = getGmailBoxes()
  if (boxes.length === 0) return NextResponse.json({ error: 'aucune boîte (IMAP_ACCOUNTS)' }, { status: 500 })

  /**
   * MODE AUTOMATIQUE (?boite=auto) — le balayage devient un filet permanent.
   *
   * Une boîte par passage, à tour de rôle : appelé une fois par jour, chaque boîte est repassée
   * tous les quatre jours sur une fenêtre de sept, donc chaque message est réexaminé au moins une
   * fois par un second regard indépendant du relevé courant. C'est ce qui transforme « on croit que
   * rien n'est perdu » en « on le vérifie ».
   */
  const auto = req.nextUrl.searchParams.get('boite') === 'auto'
  let idx = parseInt(req.nextUrl.searchParams.get('boite') ?? '-1', 10)
  if (auto) {
    const { sql: sqlRot } = await import('@/lib/db')
    const r = (await sqlRot`
      INSERT INTO agent_config (key, value, updated_at) VALUES ('balayage_rotation', '1', now())
      ON CONFLICT (key) DO UPDATE SET value = ((COALESCE(NULLIF(agent_config.value, ''), '0')::bigint + 1))::text, updated_at = now()
      RETURNING value
    `.catch(() => [] as Array<{ value: string }>)) as Array<{ value: string }>
    idx = Number(r[0]?.value ?? 0) % boxes.length
  }
  if (idx < 0 || idx >= boxes.length) {
    return NextResponse.json({
      boites: boxes.map((b, i) => ({ i, email: b.email })),
      usage: 'ajouter ?boite=N (une seule par appel), puis ?jours=30, puis ?ingerer=1 pour verser les inconnus',
    })
  }

  const box = boxes[idx]
  const jours = auto ? 7 : Math.min(90, Math.max(1, parseInt(req.nextUrl.searchParams.get('jours') ?? '30', 10)))
  const ingerer = auto || req.nextUrl.searchParams.get('ingerer') === '1'

  const { sql } = await import('@/lib/db')
  const { cleanIncomingBody, extractPlainText } = await import('@/lib/decode-body')
  const { stripQuotedReply } = await import('@/lib/reply-agent/classifier')
  const { ImapFlow } = await import('imapflow')

  const client = new ImapFlow({
    host: 'imap.gmail.com', port: 993, secure: true,
    auth: { user: box.email, pass: box.password.replace(/\s+/g, '') },
    logger: false, socketTimeout: 20_000, greetingTimeout: 10_000, connectionTimeout: 10_000,
  })

  const trouvailles: Trouvaille[] = []
  let examines = 0
  let ingeres = 0

  await client.connect()
  try {
    const lock = await client.getMailboxLock('INBOX')
    try {
      const since = new Date(Date.now() - jours * 24 * 3600 * 1000)
      const uids = (await client.search({ since })) as number[] | false
      const liste = Array.isArray(uids) ? uids : []

      // Enveloppes en bloc — une seule passe réseau.
      const envs = new Map<number, { from: string; subject: string; messageId: string; date: string }>()
      for await (const msg of client.fetch(liste, { envelope: true })) {
        const e = msg.envelope
        envs.set(msg.uid, {
          from: (e?.from?.[0]?.address ?? '').toLowerCase(),
          subject: e?.subject ?? '',
          messageId: e?.messageId ?? '',
          date: (e?.date ?? new Date()).toISOString(),
        })
      }

      const ids = [...envs.values()].map(v => 'imap:' + v.messageId).filter(Boolean)
      const froms = [...new Set([...envs.values()].map(v => v.from).filter(Boolean))]

      /**
       * ⚠️ « DÉJÀ EN BASE » SE JUGE SUR DEUX CHOSES, pas une : l'identifiant du message ET
       * l'expéditeur. Un même prospect peut avoir écrit deux fois ; si l'on ne regardait que
       * l'identifiant, on rouvrirait un fil déjà traité comme s'il était neuf.
       */
      const connusIds = new Set(
        ((await sql`SELECT instantly_reply_id AS id FROM incoming_replies WHERE instantly_reply_id = ANY(${ids.length ? ids : ['']})`) as Array<{ id: string }>)
          .map(r => r.id),
      )
      const contacts = new Map(
        ((await sql`SELECT id, LOWER(email) AS email, company FROM contacts WHERE LOWER(email) = ANY(${froms.length ? froms : ['']})`) as Array<{ id: string; email: string; company: string }>)
          .map(r => [r.email, r]),
      )

      for (const uid of liste) {
        const env = envs.get(uid)
        if (!env || !env.from) continue
        const contact = contacts.get(env.from)
        // On ne s'intéresse qu'aux VRAIS prospects : le warmup et les robots ne sont pas des leads.
        if (!contact) continue
        examines++

        const dejaEnBase = connusIds.has('imap:' + env.messageId)

        const src = await client.fetchOne(uid, { source: true }).catch(() => null)
        const raw = src && src.source ? src.source.toString() : ''
        const corps = cleanIncomingBody(extractPlainText(raw.length > 60_000 ? raw.slice(0, 60_000) : raw))
        const court = corps.replace(/\s+/g, ' ').slice(0, 400)

        const raisons = MARQUEURS_CHAUD.filter(m => m.re.test(court)).map(m => m.quoi)
        const absence = MARQUEURS_ABSENCE.test(court)
        const chaud = raisons.length > 0 && !absence

        trouvailles.push({
          boite: box.email,
          de: env.from,
          sujet: env.subject.slice(0, 90),
          recu_le: env.date,
          chaud,
          raison_chaud: absence ? ['message d\'absence, pas un lead'] : raisons,
          connu: true,
          deja_en_base: dejaEnBase,
          extrait: court.slice(0, 240),
        })

        /**
         * ⚠️ ON NE VERSE QUE LES LEADS CHAUDS JAMAIS VUS — rien d'autre.
         *
         * Premier essai : « tout ce qui n'est pas déjà en base ». Onze messages sont entrés d'un
         * coup, dont des doublons de contenu que le relevé écartait VOLONTAIREMENT. Un rattrapage
         * qui réinjecte ce qu'un filtre avait retiré ne rattrape rien, il défait le travail du
         * filtre — et il remplit la messagerie de bruit, ce qui est la meilleure façon de faire
         * rater le vrai lead au milieu.
         *
         * Le balayage existe pour une seule chose : le message d'un prospect qui veut avancer et
         * que personne n'a vu. C'est donc la seule chose qu'il verse.
         */
        if (ingerer && !dejaEnBase && chaud) {
          /**
           * On verse le message SANS classification et SANS réponse : `classification` reste nulle,
           * `action_taken` dit d'où il vient. Il apparaît dans la messagerie, personne ne lui a
           * répondu à sa place.
           */
          await sql`
            INSERT INTO incoming_replies (contact_id, from_email, subject, body, instantly_reply_id, action_taken, created_at)
            VALUES (${contact.id}, ${env.from}, ${env.subject}, ${corps}, ${'imap:' + env.messageId}, 'balayage_rattrapage', ${env.date})
            ON CONFLICT (instantly_reply_id) DO NOTHING
          `.catch(() => {})
          ingeres++
        }
      }
      lock.release()
    } finally {
      await client.logout().catch(() => {})
    }
  } catch (e) {
    return NextResponse.json({ erreur: String(e).slice(0, 200), boite: box.email }, { status: 502 })
  }

  const chauds = trouvailles.filter(t => t.chaud)
  const manques = chauds.filter(t => !t.deja_en_base)

  /**
   * ⚠️ TROUVER SANS PRÉVENIR NE SERT À RIEN. Un rattrapage qui n'écrit son résultat que dans une
   * réponse HTTP que personne ne lit est un rattrapage qui n'existe pas.
   */
  if (manques.length > 0) {
    const { alertIndependent } = await import('@/lib/alert')
    await alertIndependent(
      `${manques.length} lead(s) chaud(s) rattrape(s) dans ${box.email}`,
      [
        `Le balayage a trouve ${manques.length} message(s) de prospect que le releve courant n avait jamais vus.`,
        `Ils viennent d etre verses dans la messagerie SANS reponse automatique : a toi de decider.`,
        '',
        ...manques.map(m => `- ${m.de} (${String(m.recu_le).slice(0, 16)}) : ${m.raison_chaud.join(', ')}
  ${m.extrait.slice(0, 160)}`),
      ].join('\n'),
    )
  }

  return NextResponse.json({
    ok: true,
    boite: box.email,
    fenetre_jours: jours,
    messages_de_prospects_examines: examines,
    leads_chauds: chauds.length,
    leads_chauds_JAMAIS_VUS: manques.length,
    ingeres,
    manques,
    tous_les_chauds: chauds,
  })
}
