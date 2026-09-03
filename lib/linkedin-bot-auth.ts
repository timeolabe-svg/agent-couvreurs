import type { CronAuthResult } from '@/lib/cron-auth'

/**
 * AUTH DU BOT LINKEDIN — SECRET SÉPARÉ DE `CRON_SECRET`, exprès.
 *
 * Le bot tourne sur un VPS externe, hors de l'infrastructure Vercel/cron-job.org : sa surface
 * d'attaque n'est pas celle des crons internes. Un secret dédié se révoque indépendamment si le
 * VPS est compromis, sans casser les tâches cron-job.org existantes — et réciproquement, une
 * rotation du secret des crons ne coupe pas le bot en silence.
 *
 * Pas de tolérance de préfixe ici (contrairement à `jetonMachineValide`) : cette tolérance existe
 * chez les crons UNIQUEMENT parce que cron-job.org ajoute des variables au jeton
 * (`%cjo:uuid4%`). Le bot, c'est du code qu'on écrit nous-mêmes : une comparaison stricte suffit
 * et vaut mieux, elle ne laisse passer aucun préfixe partiel.
 */
export function checkLinkedinBotAuth(request: Request): CronAuthResult {
  const secret = process.env.LINKEDIN_BOT_SECRET
  if (!secret) return { ok: false, status: 500, error: 'LINKEDIN_BOT_SECRET not configured' }

  const entete = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (entete === secret) return { ok: true }

  let param = ''
  try {
    param = (new URL(request.url).searchParams.get('key') ?? '').trim()
  } catch { /* URL non parsable */ }
  if (param === secret) return { ok: true }

  return { ok: false, status: 401, error: 'Unauthorized' }
}
