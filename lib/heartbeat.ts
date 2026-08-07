/**
 * Chaque cron appelle pingHeartbeat À LA FIN de son run (succès ET échec). heartbeat-check compare
 * ensuite last_run_at à l'intervalle attendu pour détecter un cron qui a cessé de tourner —
 * indépendamment de ce qu'affiche cron-job.org (qui peut montrer "Succès" sur un run qui n'a rien
 * fait, ou plus rien si la tâche a été désactivée/supprimée côté ordonnanceur). Ne DOIT jamais faire
 * échouer le cron appelant : erreurs avalées en silence (le heartbeat est un filet, pas une
 * dépendance critique). Porté depuis labegaria (garde-fou commun aux deux agents).
 */
export async function pingHeartbeat(cronName: string, ok: boolean, detail?: string): Promise<void> {
  try {
    const { sql } = await import("@/lib/db")
    await sql`
      INSERT INTO cron_heartbeats (cron_name, last_run_at, last_ok, last_detail)
      VALUES (${cronName}, NOW(), ${ok}, ${detail?.slice(0, 500) ?? null})
      ON CONFLICT (cron_name) DO UPDATE SET
        last_run_at = NOW(), last_ok = ${ok}, last_detail = ${detail?.slice(0, 500) ?? null}
    `
  } catch {
    /* le heartbeat ne doit jamais faire planter le cron appelant */
  }
}
