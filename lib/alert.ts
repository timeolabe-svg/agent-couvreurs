import { getGmailBoxes, sendFromBox } from "@/lib/gmail-sender"

/**
 * ALERTE INDÉPENDANTE DES BOÎTES. Les garde-fous (heartbeat-check, self-audit) alertaient via nos
 * propres boîtes Gmail SMTP. Si les boîtes sont down (le scénario même qu'on veut détecter), aucune
 * alerte ne part → le garde-fou devient aveugle quand on en a le plus besoin.
 *
 * alertIndependent() envoie D'ABORD via ntfy.sh (push, service indépendant de tout ce qu'on possède,
 * juste un "topic" privé par obscurité) PUIS via nos boîtes Gmail (trace mail classique). Le canal
 * ntfy fonctionne même si TOUTES les boîtes Gmail sont mortes. Config : NTFY_TOPIC (chaîne
 * aléatoire). Sans cette var, on retombe sur le seul canal Gmail. Porté depuis labegaria.
 */
export async function alertIndependent(subject: string, body: string): Promise<{ ntfy: boolean; email: boolean }> {
  let ntfyOk = false
  const topic = process.env.NTFY_TOPIC
  if (topic) {
    try {
      // ⚠️ Un en-tête HTTP brut n'accepte que de l'ASCII imprimable — un titre avec emoji ou tiret
      // cadratin fait planter fetch() avec "invalid header value". On nettoie le TITRE (pas le corps).
      // Plage combinante en ̀-ͯ (échappement build-safe, pas de littéral corruptible).
      const asciiTitle = subject
        .normalize("NFKD").replace(/[̀-ͯ]/g, "")
        .replace(/[^\x20-\x7E]/g, "")
        .replace(/\s+/g, " ").trim()
        .slice(0, 200) || "Alerte Hdigiweb"
      const res = await fetch(`https://ntfy.sh/${topic}`, {
        method: "POST",
        headers: { Title: asciiTitle, Priority: "high" },
        body,
        signal: AbortSignal.timeout(6_000),
      })
      ntfyOk = res.ok
    } catch {
      ntfyOk = false
    }
  }

  let emailOk = false
  try {
    /**
     * ⚠️ JAMAIS `CLIENT_NOTIFY_EMAIL` ICI — C'ÉTAIT UNE FUITE.
     *
     * `alertIndependent` porte les alertes OPÉRATEUR : pannes, garde-fous, et surtout messages
     * RGPD/CNIL. Le repli email réutilisait l'adresse du CLIENT : il suffisait que ntfy tombe pour
     * qu'une mise en demeure ou une plainte CNIL atterrisse dans la boîte de Haris. Ce n'est pas son
     * problème, ça l'inquiète pour rien, et c'est notre responsabilité juridique, pas la sienne.
     *
     * Variable DÉDIÉE `ALERT_EMAIL`, repli sur l'adresse de Timéo. Les deux canaux ne doivent jamais
     * se croiser : ce qui va au client passe par `notifyTeam`, ce qui vient ici reste chez nous.
     */
    const recipients = (process.env.ALERT_EMAIL || "timeo.labe@gmail.com").split(",").map(s => s.trim()).filter(Boolean)
    const boxes = getGmailBoxes()
    if (boxes.length > 0) {
      for (const to of recipients) {
        const r = await sendFromBox(boxes[0], { to, subject, text: body, senderName: "Agent Hdigiweb" }).catch(() => ({ ok: false }))
        emailOk = emailOk || Boolean((r as { ok?: boolean }).ok)
      }
    }
  } catch {
    emailOk = false
  }

  return { ntfy: ntfyOk, email: emailOk }
}
