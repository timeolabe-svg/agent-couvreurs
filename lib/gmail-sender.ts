/**
 * gmail-sender.ts — envoi direct via les boîtes Google chauffées (SMTP smtp.gmail.com).
 *
 * Remplace l'envoi Instantly (qui a une limite dure de leads). On envoie depuis nos
 * propres boîtes Google Workspace (gabin@hdigiweb-*), chauffées, sans limite de leads
 * (seule limite : ~2000/jour/boîte côté Google, on reste bien en dessous).
 *
 * Instantly ne sert plus qu'au WARMUP.
 *
 * Boîtes lues depuis IMAP_ACCOUNTS (JSON) : [{"email":"gabin@x","password":"mdp app 16c","name":"Gabin"}]
 * Overrides de mot de passe possibles via GMAIL_BOX_PASSWORD_OVERRIDES.
 */
import nodemailer from 'nodemailer'

export interface GmailBox {
  email: string
  password: string
  name?: string
}

function getPasswordOverrides(): Record<string, string> {
  try {
    return JSON.parse(process.env.GMAIL_BOX_PASSWORD_OVERRIDES ?? '{}') as Record<string, string>
  } catch {
    return {}
  }
}

/** Charge les boîtes Google depuis IMAP_ACCOUNTS (email + password + name), overrides appliqués. */
export function getGmailBoxes(): GmailBox[] {
  const raw = process.env.IMAP_ACCOUNTS
  if (!raw) return []
  const overrides = getPasswordOverrides()
  try {
    const arr = JSON.parse(raw) as Array<{ email?: string; user?: string; password: string; name?: string; host?: string }>
    return arr
      .filter(a => (a.host ?? '').includes('gmail') || !a.host)
      .map(a => {
        const email = (a.email ?? a.user)!
        return { email, password: overrides[email] ?? a.password, name: a.name }
      })
      .filter(b => b.email && b.password)
  } catch {
    return []
  }
}

function buildTransport(box: GmailBox) {
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: box.email, pass: box.password.replace(/\s+/g, '') },
  })
}

export interface SendResult {
  ok: boolean
  from: string
  messageId?: string
  error?: string
}

/** Envoie un email depuis une boîte précise (texte brut). headers optionnels (ex: In-Reply-To). */
export async function sendFromBox(
  box: GmailBox,
  opts: { to: string; subject: string; text: string; senderName?: string; headers?: Record<string, string> },
): Promise<SendResult> {
  try {
    const transport = buildTransport(box)
    const info = await transport.sendMail({
      from: opts.senderName ? `"${opts.senderName}" <${box.email}>` : box.email,
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
      headers: opts.headers,
    })
    return { ok: true, from: box.email, messageId: info.messageId }
  } catch (e) {
    return { ok: false, from: box.email, error: String(e).slice(0, 200) }
  }
}
