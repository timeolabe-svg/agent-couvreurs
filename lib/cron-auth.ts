// Auth centralisée des crons.
// IMPORTANT : cron-job.org permet d'ajouter des variables dans le header, ex.
// "Bearer hdigiweb-cron-2026%cjo:uuid4%%cjo:unixtime%". Ces %cjo:...% sont
// remplacées à CHAQUE appel par des valeurs aléatoires → un match EXACT échoue
// systématiquement (401) → l'agent n'ajoute aucun lead et ne traite aucune réponse.
//
// On accepte donc le token s'il COMMENCE par le secret (la partie aléatoire est
// ajoutée à la fin). On compare aussi sur la partie fixe du secret (avant un
// éventuel %), au cas où le secret stocké en env contiendrait lui-même les
// placeholders par erreur.

export type CronAuthResult =
  | { ok: true }
  | { ok: false; status: number; error: string }

export function checkCronAuth(request: Request): CronAuthResult {
  const secret = process.env.CRON_SECRET
  if (!secret) return { ok: false, status: 500, error: 'CRON_SECRET not configured' }

  // Le token peut venir de l'en-tête Authorization OU d'un paramètre d'URL
  // (?key=... / ?token=...) — secours quand l'UI cron-job.org galère avec les en-têtes.
  const header = request.headers.get('authorization') ?? ''
  let token = header.replace(/^Bearer\s+/i, '').trim()
  if (!token) {
    try {
      const qp = new URL(request.url).searchParams
      token = (qp.get('key') ?? qp.get('token') ?? '').trim()
    } catch { /* URL non parsable */ }
  }

  // Partie fixe du secret (avant un éventuel placeholder %cjo:...%)
  const fixed = secret.split('%')[0]

  // Sécurité : on n'autorise le match par préfixe que si la partie fixe est
  // suffisamment longue (sinon n'importe quel token court passerait).
  const minLen = 8
  const exact = token === secret
  const prefixOk = fixed.length >= minLen && token.startsWith(fixed)

  if (exact || prefixOk) return { ok: true }
  return { ok: false, status: 401, error: 'Unauthorized' }
}
