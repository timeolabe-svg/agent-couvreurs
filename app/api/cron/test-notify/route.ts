/**
 * GET /api/cron/test-notify  — envoie un EXEMPLE de notif RDV (sobre) aux destinataires.
 * Sert à voir la forme finale du mail + diagnostiquer Resend (statut renvoyé).
 */
import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'
import { notifyPerRecipient } from '@/lib/notify'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const recipientsEnv = (process.env.CLIENT_NOTIFY_EMAIL ?? 'contact@hdigiweb.fr').split(',').map(s => s.trim()).filter(Boolean)
  const extra = req.nextUrl.searchParams.get('to')
  const to = [...new Set([...(extra ? [extra] : []), ...recipientsEnv])]

  const row = (label: string, value: string) =>
    `<tr><td style="padding:6px 20px 6px 0;color:#6b7280;font-size:13px;vertical-align:top">${label}</td><td style="padding:6px 0;color:#111827;font-size:14px">${value}</td></tr>`

  const html = `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;color:#111827;line-height:1.5">
  <p style="font-size:15px;margin:0 0 4px"><strong>Un rendez-vous a été pris.</strong></p>
  <p style="font-size:13px;color:#6b7280;margin:0 0 18px">Ceci est un email de TEST pour valider la forme. (Exemple avec un prospect fictif.)</p>
  <table style="border-collapse:collapse;margin-bottom:18px">
    ${row('Entreprise', '<strong>GS Rénove Couvreur — Nîmes</strong>')}
    ${row('Interlocuteur', 'M. Gorgan')}
    ${row('Téléphone', '<a href="tel:0642500043" style="color:#2563eb;text-decoration:none">06 42 50 00 43</a>')}
    ${row('Rendez-vous', '<strong>vendredi 10 juillet à 10:00</strong>')}
  </table>
  <p style="font-size:13px;font-weight:bold;color:#111827;margin:0 0 6px">Problèmes relevés sur son site (angle de vente)</p>
  <ul style="margin:0 0 18px;padding-left:18px;color:#374151;font-size:13px">
    <li style="margin-bottom:3px">Site peu visible sur "couvreur Nîmes" (référencement local faible)</li>
    <li style="margin-bottom:3px">Pas de données structurées Schema.org</li>
    <li style="margin-bottom:3px">Fiche Google non optimisée</li>
  </ul>
  <p style="font-size:13px;font-weight:bold;color:#111827;margin:0 0 6px">Résumé de l'échange</p>
  <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:12px;font-size:13px;color:#374151;white-space:pre-wrap;margin-bottom:8px">Le prospect a demandé le fonctionnement et les conditions. Intérêt clair, a donné son numéro et souhaite être rappelé. Prochaine étape : appel de Gabin au créneau convenu.</div>
  <p style="font-size:12px;color:#9ca3af;margin:0">Retrouvez la conversation complète et la fiche du prospect dans votre espace Hdigiweb.</p>
</div>`

  const res = await notifyPerRecipient(to, 'Nouveau rendez-vous — GS Rénove Couvreur (TEST)', html)
  return NextResponse.json({
    ok: res.sent.length > 0,
    envoyes: res.sent,
    echecs: res.failed,
    note: res.failed.some(f => f.error.includes('403'))
      ? 'Certains rejetés (403) = Resend en mode test : seul ton adresse owner reçoit. Vérifie un domaine sur resend.com/domains + RESEND_FROM_EMAIL pour notifier le client.'
      : undefined,
  })
}
