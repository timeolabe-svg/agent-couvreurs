/**
 * send-reply.ts — envoi d'une réponse au prospect via le moteur MAISON (SMTP Gmail).
 *
 * Remplace l'ancien Instantly `sendReply`. On répond depuis la boîte gabin@ qui a
 * contacté ce prospect (cohérence signature/enveloppe), en "Re: <sujet d'origine>".
 * Utilisé par : poll-imap-replies (auto-réponses programmées) + validation humaine.
 */
import { getGmailBoxes, sendFromBox } from '@/lib/gmail-sender'
import { getInboxSenderName } from '@/lib/instantly/inbox-rotation'

export interface SendReplyResult {
  ok: boolean
  via?: string
  to?: string
  error?: string
}

/** Envoie la réponse `body` au prospect à l'origine de l'incoming_reply donné. */
export async function sendReplyEmail(incomingReplyId: string, body: string): Promise<SendReplyResult> {
  const { sql } = await import('@/lib/db')
  const rows = (await sql`
    SELECT ir.from_email, ir.subject, ir.contact_id, ir.created_at,
           (SELECT eq.from_email FROM email_queue eq
              WHERE eq.contact_id = ir.contact_id AND eq.status = 'sent' AND eq.from_email IS NOT NULL
              ORDER BY eq.sent_at DESC LIMIT 1) AS owning_box
    FROM incoming_replies ir
    WHERE ir.id = ${incomingReplyId}
    LIMIT 1
  `) as Array<{ from_email: string; subject: string | null; contact_id: string | null; created_at: string | null; owning_box: string | null }>

  const r = rows[0]
  if (!r || !r.from_email) return { ok: false, error: 'incoming reply introuvable ou sans adresse' }

  /**
   * ⚠️ JAMAIS DEUX MESSAGES DE L'AGENT AU MÊME PROSPECT À QUELQUES MINUTES D'INTERVALLE.
   *
   * Le 25/08, Jaky Lesage a reçu trois messages en dix-neuf minutes, dont un rappel de rendez-vous
   * pour le lendemain alors qu'il venait d'écrire « je suis disponible MAINTENANT ». Entre-temps
   * Timéo lui avait répondu à la main depuis la boîte pour lui dire qu'il l'appelait dans quelques
   * minutes. Le prospect a reçu trois voix différentes sur le même fil, et Timéo a dû envoyer un
   * mail d'excuse en prétendant s'être trompé de destinataire.
   *
   * Un prospect ne lit pas des « chemins de code », il lit UNE conversation. Chaque chemin se
   * croyait seul et avait raison isolément — c'est justement pour ça que le garde-fou est ICI,
   * dans le seul passage par lequel toute réponse de l'agent sort. Une règle posée dans un appelant
   * ne protège que cet appelant.
   *
   * ⚠️ Ce délai n'est PAS un confort de style : c'est ce qui a coûté un rendez-vous.
   */
  /**
   * ⚠️ LE DÉLAI NE S'APPLIQUE PAS QUAND LE PROSPECT VIENT D'ÉCRIRE.
   *
   * Question de Timéo : « tu n'attends pas 2 h avant de répondre au lead quand même ? » Non, et
   * c'était pourtant le défaut de ma première version : le délai comptait depuis notre dernier
   * message, quel qu'il soit. Un prospect qui répondait trente minutes après un mail de séquence
   * aurait attendu quatre-vingt-dix minutes sa réponse — exactement l'inverse du but recherché.
   *
   * La règle juste tient en une phrase : **si le prospect a parlé depuis notre dernier message, on
   * répond tout de suite.** Le délai ne sert qu'à empêcher un SECOND message quand personne n'a
   * rien dit entre les deux — le cas de Jaky Lesage, six messages en vingt et une minutes.
   *
   * Autrement dit, on ne borne pas la vitesse de réponse, on borne le monologue.
   */
  const DELAI_MIN_ENTRE_MESSAGES_MIN = Number(process.env.DELAI_MIN_ENTRE_MESSAGES_MIN ?? 120)
  if (r.contact_id) {
    const recent = (await sql`
      SELECT MAX(t.quand) AS dernier FROM (
        SELECT eq.sent_at AS quand FROM email_queue eq
          WHERE eq.contact_id = ${r.contact_id} AND eq.status = 'sent'
        UNION ALL
        SELECT rd.sent_at FROM reply_drafts rd
          JOIN incoming_replies ir2 ON ir2.id = rd.incoming_reply_id
          WHERE ir2.contact_id = ${r.contact_id} AND rd.status = 'sent'
        UNION ALL
        /**
         * ⚠️ ET SURTOUT CE QUE TIMÉO A ÉCRIT LUI-MÊME depuis Gmail. Ces messages n'existent ni dans
         * la file ni dans les brouillons : sans cette source, l'agent croit que personne n'a
         * répondu et écrit par-dessus la réponse d'un humain. Alimenté par le relevé du dossier
         * des envoyés.
         */
        SELECT mh.envoye_le FROM messages_humains mh
          WHERE LOWER(mh.destinataire) = LOWER(${r.from_email})
      ) t
    `.catch(() => [{ dernier: null }])) as Array<{ dernier: string | null }>
    const dernier = recent[0]?.dernier ? new Date(recent[0].dernier).getTime() : 0
    const minutes = dernier ? (Date.now() - dernier) / 60_000 : Infinity

    // Le prospect a-t-il écrit APRÈS notre dernier message ? Si oui, il attend une réponse : on la
    // lui donne immédiatement, quel que soit le délai.
    const apres = (await sql`
      SELECT MAX(created_at) AS dernier_recu FROM incoming_replies WHERE contact_id = ${r.contact_id}
    `) as Array<{ dernier_recu: string | null }>
    const dernierRecu = apres[0]?.dernier_recu ? new Date(apres[0].dernier_recu).getTime() : 0
    const prospectAParleDepuis = dernierRecu > dernier

    /**
     * ⚠️ LA RÈGLE PRINCIPALE : QUELQU'UN A-T-IL DÉJÀ RÉPONDU À CE MESSAGE ?
     *
     * Consigne de Timéo, 25/08 : « des fois j'ai déjà répondu manuellement donc il ne faut pas
     * renvoyer de message ». Le délai seul ne l'attrape pas : chez Jaky Lesage, le prospect écrivait
     * entre chaque message, donc « le prospect a parlé depuis » restait vrai à chaque tour pendant
     * que trois voix se répondaient sur le même fil.
     *
     * La bonne question n'est pas « quand ai-je écrit pour la dernière fois » mais « ce message-ci
     * a-t-il déjà reçu une réponse ». Si un envoi est sorti de la boîte APRÈS l'arrivée du message
     * auquel on veut répondre, il a déjà été traité, par l'agent ou par un humain. On se tait.
     */
    /**
     * ⚠️ UNE RELANCE DE SÉQUENCE N'EST PAS UNE RÉPONSE À CE MESSAGE (corrigé le 31/08).
     *
     * Cette garde comparait la date d'arrivée du message à `dernier` — le dernier envoi TOUTES
     * SOURCES CONFONDUES, y compris `email_queue`, c'est-à-dire les mails de séquence.
     *
     * Conséquence mesurée : les trois brouillons en attente de validation étaient tous refusés.
     * Le cas type est la reprise après congés — un prospect répond « fermé jusqu'au 21 août » le 14,
     * la séquence continue normalement, et le message de reprise préparé pour le 22 est rejeté au
     * motif qu'« un envoi est parti après son arrivée ». Timéo appuyait sur Envoyer et il ne se
     * passait rien.
     *
     * La question que cette garde doit poser est « QUELQU'UN A-T-IL RÉPONDU À CE MESSAGE ? », pas
     * « avons-nous écrit depuis ». Une réponse, c'est :
     *   · un brouillon d'agent réellement envoyé pour CE message précis ;
     *   · un mail écrit à la main à cette personne après l'arrivée du message.
     * Un mail de campagne programmé de longue date n'est ni l'un ni l'autre.
     *
     * Le délai anti-monologue plus bas, lui, continue de compter TOUS les envois : là, c'est bien
     * la question « lui a-t-on déjà écrit récemment » qui se pose.
     */
    const arrivee = r.created_at ? new Date(r.created_at).getTime() : 0
    if (arrivee) {
      /**
       * ⚠️ LA TABLE S'APPELLE `messages_humains` MAIS ELLE NE CONTIENT PAS QUE DES HUMAINS.
       *
       * Le relevé du dossier « Envoyés » enregistre TOUT ce qui sort des boîtes — de l'agent comme
       * de la main de Timéo — et c'est volontaire : elle sert d'abord au délai anti-monologue, où
       * seule compte la date du dernier message parti, quel qu'en soit l'auteur.
       *
       * Mais l'utiliser telle quelle pour répondre à « un HUMAIN a-t-il répondu ? » est faux : les
       * mails de séquence de l'agent y figurent, et la garde se déclencherait sur nos propres envois.
       * Mesuré le 31/08 : 1 394 lignes sur trente jours, soit le volume de l'agent, pas celui d'un
       * humain. Le nom de la table promet une chose, son contenu en dit une autre.
       *
       * On écarte donc les lignes qui correspondent à un envoi CONNU de la machine : un mail de
       * campagne ou une réponse d'agent partis à la même seconde près. Ce qui reste est écrit à la
       * main.
       */
      const reponses = (await sql`
        SELECT MAX(t.quand) AS derniere FROM (
          SELECT rd.sent_at AS quand FROM reply_drafts rd
            WHERE rd.incoming_reply_id = ${incomingReplyId} AND rd.status = 'sent'
          UNION ALL
          SELECT mh.envoye_le FROM messages_humains mh
            WHERE LOWER(mh.destinataire) = LOWER(r.from_email)
              AND NOT EXISTS (
                SELECT 1 FROM email_queue eq
                WHERE eq.contact_id = ${r.contact_id} AND eq.status = 'sent'
                  AND eq.sent_at BETWEEN mh.envoye_le - INTERVAL '3 minutes'
                                     AND mh.envoye_le + INTERVAL '3 minutes'
              )
              AND NOT EXISTS (
                SELECT 1 FROM reply_drafts rd2
                JOIN incoming_replies ir2 ON ir2.id = rd2.incoming_reply_id
                WHERE ir2.contact_id = ${r.contact_id} AND rd2.status = 'sent'
                  AND rd2.sent_at BETWEEN mh.envoye_le - INTERVAL '3 minutes'
                                      AND mh.envoye_le + INTERVAL '3 minutes'
              )
        ) t
      `.catch(() => [{ derniere: null }])) as Array<{ derniere: string | null }>
      const dejaRepondu = reponses[0]?.derniere ? new Date(reponses[0].derniere).getTime() : 0
      if (dejaRepondu > arrivee) {
        return {
          ok: false,
          error: `ce message a déjà reçu une réponse (partie ${Math.round((dejaRepondu - arrivee) / 60_000)} min après son arrivée)`,
        }
      }
    }

    if (minutes < DELAI_MIN_ENTRE_MESSAGES_MIN && !prospectAParleDepuis) {
      return {
        ok: false,
        error: `un message est déjà parti à ce prospect il y a ${Math.round(minutes)} min et il n'a rien écrit depuis (délai minimum ${DELAI_MIN_ENTRE_MESSAGES_MIN} min entre deux messages de notre part)`,
      }
    }
  }

  const boxes = getGmailBoxes()
  if (boxes.length === 0) return { ok: false, error: 'aucune boîte Gmail (IMAP_ACCOUNTS)' }

  // Boîte émettrice : celle qui a contacté ce prospect ; sinon la première dispo.
  const box = boxes.find(b => b.email.toLowerCase() === (r.owning_box ?? '').toLowerCase()) ?? boxes[0]

  const baseSubject = (r.subject ?? '').replace(/^\s*(re\s*:\s*)+/i, '').trim()
  const subject = baseSubject ? `Re: ${baseSubject}` : 'Re: votre message'

  /**
   * ⚠️ LE PIED DE PAGE LÉGAL MANQUAIT SUR CE CHEMIN (audit croisé du 26/08, session Optimum).
   *
   * `send-campaign` posait bien le bloc RGPD et les en-têtes `List-Unsubscribe` sur les mails de
   * séquence. Les RÉPONSES, elles, partaient sans rien : ni mention d'origine des coordonnées, ni
   * lien de désinscription, ni bouton natif dans Gmail. Or une réponse à un prospect démarché reste
   * de la prospection commerciale — la même obligation s'applique.
   *
   * Encore le même motif que toute la journée : la règle existait, dans UN SEUL des deux chemins par
   * lesquels un mail sort. On la pose donc ici aussi, avec la même garde anti-empilement.
   */
  const { blocLegalRgpd } = await import('@/lib/rgpd')
  const { creerJetonDesabo } = await import('@/lib/unsubscribe-token')
  const base = (process.env.PUBLIC_APP_URL || 'https://agent-couvreurs.vercel.app').replace(/\/+$/, '')
  const lienDesabo = `${base}/u/${creerJetonDesabo(r.from_email)}`

  let corpsFinal = body
  if (!/coordonnées professionnelles proviennent/i.test(corpsFinal)) {
    corpsFinal = `${corpsFinal.trimEnd()}\n\n${blocLegalRgpd(lienDesabo)}`
  }

  const res = await sendFromBox(box, {
    to: r.from_email,
    subject,
    text: corpsFinal,
    senderName: getInboxSenderName(box.email),
    headers: {
      'List-Unsubscribe': `<${lienDesabo}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  })
  return { ok: res.ok, via: box.email, to: r.from_email, error: res.error }
}
