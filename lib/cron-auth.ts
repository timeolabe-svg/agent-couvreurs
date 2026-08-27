// Auth centralisée des crons.
//
// ⚠️ NE JAMAIS ÉCRIRE LA VALEUR DU SECRET ICI. Elle y figurait, dans l'exemple ci-dessous, et un
// commentaire est aussi lisible que du code : la session Revele a pu interroger la production avec.
// Un secret cité « pour l'exemple » est un secret publié.
//
// IMPORTANT : cron-job.org permet d'ajouter des variables dans le header, ex.
// "Bearer <CRON_SECRET>%cjo:uuid4%%cjo:unixtime%". Ces %cjo:...% sont
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

  /**
   * ⚠️ UNE SOURCE PÉRIMÉE NE DOIT JAMAIS ANNULER UNE SOURCE VALIDE (27/08, signalé par la session
   * LabegarIA qui vient d'en subir la panne).
   *
   * Le code lisait le paramètre d'URL UNIQUEMENT si l'en-tête était vide :
   *
   *     let token = header ; if (!token) token = ?key=
   *
   * Or cinq de nos tâches cron-job.org portent la clé dans un en-tête `Authorization`. Le jour où
   * Timéo corrige la clé dans l'URL d'une tâche sans toucher à son en-tête, **l'en-tête périmé
   * gagne** et la tâche passe en 401 — sans erreur visible côté ordonnanceur, qui affiche seulement
   * « échec ». Chez LabegarIA, `autopilot-tick` et `send-campaign` sont tombés comme ça, en silence,
   * et la cause a été cherchée du côté de l'environnement et du cache de build avant qu'on pense à
   * regarder ici.
   *
   * On teste donc CHAQUE source séparément, et on accepte si l'UNE d'elles est valide. Ce n'est pas
   * plus permissif : chaque source doit toujours correspondre au secret.
   */
  const entete = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  let param = ''
  try {
    const qp = new URL(request.url).searchParams
    param = (qp.get('key') ?? qp.get('token') ?? '').trim()
  } catch { /* URL non parsable */ }

  if (jetonMachineValide(entete, secret) || jetonMachineValide(param, secret)) return { ok: true }
  return { ok: false, status: 401, error: 'Unauthorized' }
}

/**
 * Un jeton est-il valide pour ce secret ? SOURCE UNIQUE DE LA RÈGLE.
 *
 * ⚠️ Elle était recopiée dans `proxy.ts`. Une règle d'authentification recopiée est une règle qui
 * divergera — et sur l'authentification, une copie protège pendant que l'autre bloque. C'est
 * exactement ce qui est arrivé à la session LabegarIA : la route acceptait, le middleware refusait
 * en amont, et le diagnostic a pris des heures.
 *
 * La tolérance de préfixe existe parce que cron-job.org ajoute des variables au jeton
 * (`%cjo:uuid4%`), remplacées à chaque appel : une comparaison stricte échouerait à tous les coups.
 */
export function jetonMachineValide(jeton: string, secret = process.env.CRON_SECRET ?? ''): boolean {
  if (!jeton || !secret) return false
  if (jeton === secret) return true
  // Partie fixe du secret (avant un éventuel placeholder %cjo:...%). On n'autorise le match par
  // préfixe que si cette partie est assez longue, sinon n'importe quel jeton court passerait.
  const fixe = secret.split('%')[0]
  return fixe.length >= 8 && jeton.startsWith(fixe)
}
