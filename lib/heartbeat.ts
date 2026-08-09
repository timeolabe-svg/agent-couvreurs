/**
 * Chaque cron appelle pingHeartbeat À LA FIN de son run (succès ET échec). heartbeat-check compare
 * ensuite last_run_at à l'intervalle attendu pour détecter un cron qui a cessé de tourner —
 * indépendamment de ce qu'affiche cron-job.org (qui peut montrer "Succès" sur un run qui n'a rien
 * fait, ou plus rien si la tâche a été désactivée/supprimée côté ordonnanceur). Ne DOIT jamais faire
 * échouer le cron appelant : erreurs avalées en silence (le heartbeat est un filet, pas une
 * dépendance critique). Porté depuis labegaria (garde-fou commun aux deux agents).
 */
/**
 * ⚠️ `expectedMinutes` ajouté le 09/08 (alignement sur labegaria). Quand l'appelant connaît sa
 * fréquence, il la déclare ici : heartbeat-check n'a plus besoin d'une migration lancée à la main
 * pour surveiller un cron ajouté après coup. LAISSER VIDE si on n'est pas certain que la tâche est
 * réellement planifiée — un intervalle sur un cron à l'arrêt le fait crier « MUET » en boucle, et
 * une alerte qui se déclenche pour rien tous les jours finit par masquer les vraies.
 * On ne remplace jamais une valeur déjà réglée : COALESCE garde ce qui a été posé à la main.
 */
export async function pingHeartbeat(
  cronName: string,
  ok: boolean,
  detail?: string,
  expectedMinutes?: number,
): Promise<void> {
  try {
    const { sql } = await import("@/lib/db")
    await sql`
      INSERT INTO cron_heartbeats (cron_name, last_run_at, last_ok, last_detail, expected_interval_minutes)
      VALUES (${cronName}, NOW(), ${ok}, ${detail?.slice(0, 500) ?? null}, ${expectedMinutes ?? null})
      ON CONFLICT (cron_name) DO UPDATE SET
        last_run_at = NOW(), last_ok = ${ok}, last_detail = ${detail?.slice(0, 500) ?? null},
        expected_interval_minutes = COALESCE(cron_heartbeats.expected_interval_minutes, ${expectedMinutes ?? null})
    `
  } catch {
    /* le heartbeat ne doit jamais faire planter le cron appelant */
  }
}
