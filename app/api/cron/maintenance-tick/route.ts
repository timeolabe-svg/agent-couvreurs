import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'
import { pingHeartbeat } from '@/lib/heartbeat'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * DÉCLENCHE LES TRAVAUX PÉRIODIQUES QUI N'ONT JAMAIS ÉTÉ PROGRAMMÉS.
 *
 * ⚠️ CONSTAT DU 20/08. Neuf crons de ce projet ont tous un « dernier passage » au 09/08, entre
 * 18h41 et 18h42 : c'est la signature d'UN passage manuel, pas d'une exécution périodique. Ils
 * existent dans le code, ils fonctionnent quand on les appelle, et **personne ne les appelle**.
 *
 * Timéo l'a vu avant moi : « c'est bizarre, je n'ai pas de cron Hdigiweb en orange ». Évidemment —
 * un cron qui n'existe pas chez l'ordonnanceur ne peut pas échouer. C'est la panne la plus discrète
 * qui soit : rien n'est rouge, rien n'alerte, le travail ne se fait simplement jamais.
 *
 * Plutôt que de dépendre d'un enregistrement manuel qu'il faut penser à créer (et qui peut être
 * supprimé sans que rien ne le signale), on greffe ces travaux au moteur d'envoi, qui tourne toutes
 * les 10 minutes. Chacun garde sa propre cadence, mesurée sur son dernier battement réel.
 *
 * ⚠️ Ne sont PAS greffés ici, volontairement :
 *   - `fix-false-optout` : il a déjà re-débloqué des refus le matin même où on les avait bloqués.
 *     Un cron qui touche à des oppositions ne se lance pas tout seul (règle d'or RGPD).
 *   - les nettoyages ponctuels (cleanup-junk, dedupe-rdv…) : sans valeur métier quotidienne, et un
 *     nettoyage automatique non surveillé finit toujours par effacer ce qu'il ne fallait pas.
 */

interface Travail {
  cron: string
  /** Cadence voulue, en heures. */
  toutesLesHeures: number
  pourquoi: string
}

const TRAVAUX: Travail[] = [
  {
    cron: 'watchlist-recheck',
    toutesLesHeures: 24,
    pourquoi: 'repêche les prospects qui viennent de franchir les 20 avis Google',
  },
  {
    cron: 'weekly-learning',
    toutesLesHeures: 24 * 7,
    pourquoi: 'rapport d\'apprentissage hebdomadaire',
  },
  {
    cron: 'self-improve',
    toutesLesHeures: 24 * 30,
    pourquoi: 'ajustement mensuel de la stratégie',
  },
]

/**
 * ── PARTAGE HEBDOMADAIRE DU VIVIER AVEC LES AUTRES PROJETS ──────────────────────
 *
 * Consigne permanente de Timéo, redonnée le 21/08 : « toutes les semaines tu envoies un fichier
 * des leads que t'as pas utilisés à tous les autres projets, qui piochent ce qui correspond à leur
 * cible ». Les entreprises du bâtiment intéressent Hdigiweb (site internet), Revele (timelapse de
 * chantier), Optimum Expertise et les projets à venir : une donnée publique déjà payée n'a aucune
 * raison d'être rachetée trois fois.
 *
 * ⚠️ C'ÉTAIT UNE CONSIGNE SANS DÉCLENCHEUR. Les deux exports existaient en endpoint admin et
 * n'avaient tourné qu'à la main — le 10 et le 16 août. Une consigne « toutes les semaines » qui
 * dépend d'un clic n'est pas hebdomadaire, elle est oubliée.
 *
 * ⚠️ ET LA RÈGLE QUI PRIME SUR TOUT : l'opposition suit la PERSONNE, pas la campagne. Quiconque a
 * dit stop à Hdigiweb ne doit jamais être contacté par Revele — le filtre blocklist vit dans les
 * endpoints d'export, il ne se contourne pas ici.
 */
const PARTAGES_HEBDO = ['export-vers-revele', 'export-vers-labegaria']

async function handler(req: NextRequest) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { sql } = await import('@/lib/db')
  const base = (process.env.PUBLIC_APP_URL || 'https://agent-couvreurs.vercel.app').replace(/\/+$/, '')
  const cle = process.env.CRON_SECRET ?? ''

  const battements = (await sql`
    SELECT cron_name, last_run_at FROM cron_heartbeats
  `) as Array<{ cron_name: string; last_run_at: string | null }>
  const dernier = new Map(battements.map(b => [b.cron_name, b.last_run_at]))

  const lances: string[] = []
  const attendus: string[] = []

  // Le partage du vivier passe en premier : c'est un engagement pris envers d'autres projets.
  for (const nom of PARTAGES_HEBDO) {
    const d = dernier.get(nom)
    const heures = d ? (Date.now() - new Date(d).getTime()) / 3_600_000 : Infinity
    if (heures < 24 * 7) { attendus.push(`${nom} (dernier partage il y a ${Math.round(heures / 24)} j)`); continue }
    try {
      const r = await fetch(`${base}/api/admin/${nom}?key=${cle}`, { signal: AbortSignal.timeout(25_000) })
      lances.push(`${nom} → HTTP ${r.status} (partage hebdomadaire du vivier)`)
    } catch (e) {
      lances.push(`${nom} → échec : ${String(e).slice(0, 80)}`)
    }
    break
  }
  if (lances.length > 0) {
    await pingHeartbeat('maintenance-tick', true, `partage=${lances.length}`, 60)
    return NextResponse.json({ ok: true, lances, pas_encore_dus: attendus })
  }

  for (const t of TRAVAUX) {
    const d = dernier.get(t.cron)
    const heures = d ? (Date.now() - new Date(d).getTime()) / 3_600_000 : Infinity
    if (heures < t.toutesLesHeures) {
      attendus.push(`${t.cron} (dernier passage il y a ${Math.round(heures)} h, cadence ${t.toutesLesHeures} h)`)
      continue
    }
    /**
     * ⚠️ UN SEUL TRAVAIL PAR PASSAGE. Le moteur d'envoi tourne toutes les 10 minutes et doit rendre
     * la main sous 30 secondes : enchaîner trois traitements lourds ferait sauter SON budget, donc
     * les envois. Ce qui n'est pas lancé aujourd'hui le sera au passage suivant.
     */
    try {
      const r = await fetch(`${base}/api/cron/${t.cron}?key=${cle}`, { signal: AbortSignal.timeout(25_000) })
      lances.push(`${t.cron} → HTTP ${r.status} (${t.pourquoi})`)
    } catch (e) {
      lances.push(`${t.cron} → échec : ${String(e).slice(0, 80)}`)
    }
    break
  }

  await pingHeartbeat('maintenance-tick', true, `lances=${lances.length}`, 60)

  return NextResponse.json({
    ok: true,
    lances,
    pas_encore_dus: attendus,
    lecture: 'Ces travaux ne sont pas programmés chez l\'ordonnanceur : ils sont déclenchés ici, à leur cadence, depuis un cron qui tourne vraiment.',
  })
}

export const GET = handler
