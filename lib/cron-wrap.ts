import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { pingHeartbeat } from '@/lib/heartbeat'

/**
 * ENVELOPPE STANDARD D'UN CRON : capture d'erreur de bout en bout + battement.
 *
 * ⚠️ AUDIT 09/08 — 17 crons sur 26 n'avaient NI enveloppe d'erreur NI battement. Une exception
 * (base injoignable, champ undefined, fetch qui casse, timeout d'une lib) produisait donc un 500
 * opaque : côté cron-job.org on voit « Échec » sans le moindre motif, et rien n'est enregistré
 * nulle part. C'est exactement ce qui a fait perdre 19 jours de scraping — le tableau de bord
 * affichait « Succès » et personne ne pouvait savoir pourquoi rien ne sortait.
 *
 * ⚠️ `expectedMinutes` VOLONTAIREMENT OPTIONNEL. Poser un intervalle attendu sur un cron qui n'est
 * pas réellement planifié le ferait crier « MUET » à chaque passage du garde-fou — et une alerte
 * qui se déclenche tous les jours pour rien finit par être ignorée, ce qui masque les vraies.
 * Sans intervalle, le battement enregistre la vie du cron sans jamais alerter : la visibilité
 * d'abord, l'alerte seulement quand on sait que la tâche tourne pour de bon.
 */
export function wrapCron(
  nom: string,
  // NextRequest et non Request : certains handlers utilisent req.nextUrl / req.cookies.
  handler: (req: NextRequest) => Promise<Response>,
  expectedMinutes?: number,
) {
  return async function GET(req: NextRequest): Promise<Response> {
    try {
      const res = await handler(req)
      const ok = res.status < 400
      let detail: string | undefined
      if (!ok) {
        try { detail = String(((await res.clone().json()) as { error?: string })?.error ?? '').slice(0, 300) } catch { /* corps illisible */ }
      }
      await pingHeartbeat(nom, ok, detail, expectedMinutes).catch(() => {})
      return res
    } catch (err) {
      const e = err as { message?: string; cause?: { message?: string }; code?: string }
      const motif = String(e?.message ?? err).slice(0, 300)
      console.error(`[${nom}]`, err)
      await pingHeartbeat(nom, false, motif, expectedMinutes).catch(() => {})
      return NextResponse.json(
        { ok: false, error: motif, cause: e?.cause?.message?.slice(0, 200), code: e?.code },
        { status: 500 },
      )
    }
  }
}
