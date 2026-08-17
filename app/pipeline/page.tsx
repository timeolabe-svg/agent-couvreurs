'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarClock, Target, CheckCircle2, CircleSlash, Phone, Mail, MapPin, X, Euro } from 'lucide-react'

/**
 * SUIVI DES RENDEZ-VOUS — l'écran de Haris.
 *
 * ⚠️ BARÈME HDIGIWEB : 50 € par rendez-vous qualifié + 5 % du CA généré. Ce n'est PAS celui de
 * Revele (10 € + 400 €). Les deux pages se ressemblent ; leurs montants ne doivent jamais être
 * recopiés de l'une à l'autre.
 *
 * Le principe : Haris classe lui-même ses rendez-vous et saisit le CA qu'il a réellement encaissé.
 * La commission se calcule seule — il n'a pas de règle de trois à faire, et Timéo n'a rien à
 * réclamer. Un chiffre que les deux parties voient au même endroit, calculé de la même façon, ne
 * se discute pas.
 */

interface Rdv {
  id: string
  scheduled_at: string
  status: string | null
  crm_stage: string | null
  unqualified_reason: string | null
  montant_mensuel: number | null
  client_actif_jusqu_a: string | null
  client_actif: boolean
  part_fixe: number
  commission_mensuelle: number
  signed_at: string | null
  client_note: string | null
  notes: string | null
  company: string | null
  name: string | null
  city: string | null
  phone: string | null
  email: string | null
}

type EtapeKey = 'a_venir' | 'qualifie' | 'signe' | 'perdu' | 'non_qualifie'

/**
 * ⚠️ Un rendez-vous PASSÉ et non classé n'est pas « à venir » : il attend une décision.
 * Les laisser dans une case au nom rassurant garantit que personne ne les classera jamais —
 * c'est ainsi que 8 rendez-vous de juillet dormaient sans que rien ne le signale.
 */
const estAClasser = (r: Rdv) => (r.crm_stage ?? 'a_venir') === 'a_venir' && new Date(r.scheduled_at).getTime() < Date.now()

const ETAPES: Array<{ key: EtapeKey; label: string; color: string; aide: string; badge: string | null; icon: React.ElementType }> = [
  { key: 'a_venir',      label: 'À venir',      color: '#5f83ac', badge: null,     aide: 'Calé, pas encore eu lieu — ne compte pas encore', icon: CalendarClock },
  { key: 'qualifie',     label: 'Qualifié',     color: '#c19653', badge: '+50 €',  aide: 'Honoré, décisionnaire, concerné (intéressé ou non)', icon: Target },
  { key: 'signe',        label: 'Client signé', color: '#5c9b82', badge: '+50 € et 5 %/mois', aide: 'Devenu client — saisis son abonnement mensuel', icon: CheckCircle2 },
  { key: 'perdu',        label: 'Perdu',        color: '#7a6b6b', badge: '+50 €',  aide: 'Qualifié mais pas transformé — les 50 € restent dus', icon: CircleSlash },
  { key: 'non_qualifie', label: 'Non qualifié', color: '#9a6b6b', badge: null,     aide: 'No-show, pas décisionnaire ou hors sujet — 0 €', icon: CircleSlash },
]

const MOTIFS = [
  { key: 'no_show', label: "Ne s'est pas présenté" },
  { key: 'hors_offre', label: "N'est pas là pour l'offre qu'on propose" },
  { key: 'pas_decisionnaire', label: "Ce n'est pas la personne décisionnaire qui est présente" },
]

const meta = (k: string | null) => ETAPES.find(e => e.key === (k ?? 'a_venir')) ?? ETAPES[0]
const euros = (n: number) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const jour = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })

export default function PipelinePage() {
  const [rdvs, setRdvs] = useState<Rdv[]>([])
  const [kpi, setKpi] = useState<Record<string, number>>({})
  const [ouvert, setOuvert] = useState<string | null>(null)
  const [filtre, setFiltre] = useState<EtapeKey | 'tous' | 'a_classer'>('tous')
  const [charge, setCharge] = useState(true)

  const load = useCallback(async () => {
    setCharge(true)
    try {
      const r = await fetch('/api/pipeline')
      const j = await r.json() as { rdvs: Rdv[]; kpi: Record<string, number> }
      setRdvs(j.rdvs ?? [])
      setKpi(j.kpi ?? {})
    } catch { /* ignore */ }
    setCharge(false)
  }, [])
  useEffect(() => { void load() }, [load])

  const patch = async (id: string, champs: Record<string, unknown>) => {
    await fetch('/api/pipeline', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...champs }),
    })
    await load()
  }

  const listes = useMemo(
    () => filtre === 'tous' ? rdvs
      : filtre === 'a_classer' ? rdvs.filter(estAClasser)
      : filtre === 'a_venir' ? rdvs.filter(r => (r.crm_stage ?? 'a_venir') === 'a_venir' && !estAClasser(r))
      : rdvs.filter(r => (r.crm_stage ?? 'a_venir') === filtre),
    [rdvs, filtre],
  )
  const courant = rdvs.find(r => r.id === ouvert) ?? null

  return (
    <div className="p-6 max-w-6xl mx-auto" style={{ color: 'var(--color-text)' }}>
      <h1 className="text-lg font-semibold mb-1">Suivi des rendez-vous</h1>
      <p className="text-sm mb-5" style={{ color: 'var(--color-muted)' }}>
        50 € par rendez-vous qualifié, plus 5 % du chiffre d&apos;affaires généré. Classe chaque
        rendez-vous et saisis le CA encaissé : le montant se calcule tout seul.
      </p>

      {/* Chiffres du haut : activité à gauche, argent à droite — ils ne mesurent pas la même chose. */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        <Case label="Rendez-vous" valeur={String(kpi.total ?? 0)} />
        <Case label="À classer" valeur={String(kpi.aClasser ?? 0)} couleur={(kpi.aClasser ?? 0) > 0 ? "#e0a33e" : undefined} />
        <Case label="Qualifiés" valeur={String(kpi.qualifies ?? 0)} couleur="#c19653" />
        <Case label="Clients actifs" valeur={String(kpi.clientsActifs ?? 0)} couleur="#5c9b82" />
        <Case label="Fixe acquis" valeur={euros(kpi.fixeAcquis ?? 0)} couleur="#c19653" />
        <Case label="Abonnements clients" valeur={euros(kpi.caMensuelClients ?? 0) + "/mois"} couleur="#5f83ac" />
        <Case label="Récurrent 5 %" valeur={euros(kpi.commissionMensuelle ?? 0) + "/mois"} couleur="#5c9b82" fort />
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <Onglet actif={filtre === 'tous'} onClick={() => setFiltre('tous')} label={`Tous (${rdvs.length})`} couleur="var(--color-accent)" />
        <Onglet actif={filtre === 'a_classer'} onClick={() => setFiltre('a_classer')} label={`À classer (${rdvs.filter(estAClasser).length})`} couleur="#e0a33e" />
        {ETAPES.map(e => {
          const n = e.key === 'a_venir'
            ? rdvs.filter(r => (r.crm_stage ?? 'a_venir') === 'a_venir' && !estAClasser(r)).length
            : rdvs.filter(r => (r.crm_stage ?? 'a_venir') === e.key).length
          return <Onglet key={e.key} actif={filtre === e.key} onClick={() => setFiltre(e.key)} label={`${e.label} (${n})`} couleur={e.color} />
        })}
      </div>

      {charge && <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Chargement…</p>}
      {!charge && listes.length === 0 && (
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Aucun rendez-vous dans cette catégorie.</p>
      )}

      <div className="flex flex-col gap-2">
        {listes.map(r => {
          const m = meta(r.crm_stage)
          const Icone = m.icon
          return (
            <button
              key={r.id}
              onClick={() => setOuvert(r.id)}
              className="text-left rounded-lg px-4 py-3 flex items-center gap-3"
              style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface-2)' }}
            >
              <Icone size={15} style={{ color: m.color, flexShrink: 0 }} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{r.company ?? r.email ?? 'Sans nom'}</div>
                <div className="text-[11px]" style={{ color: 'var(--color-muted-2)' }}>
                  {jour(r.scheduled_at)}{r.city ? ` · ${r.city}` : ''}
                  {r.crm_stage === 'non_qualifie' && r.unqualified_reason
                    ? ` · ${MOTIFS.find(x => x.key === r.unqualified_reason)?.label ?? ''}` : ''}
                </div>
              </div>
              <span className="text-[11px] px-2 py-0.5 rounded-full flex-shrink-0"
                style={{ background: (estAClasser(r) ? '#e0a33e' : m.color) + '22', color: estAClasser(r) ? '#e0a33e' : m.color }}>{estAClasser(r) ? 'À classer' : m.label}</span>
              <span className="text-sm font-semibold w-20 text-right flex-shrink-0"
                style={{ color: (r.commission_mensuelle > 0 || r.part_fixe > 0) ? '#5c9b82' : 'var(--color-muted-2)' }}>
                {r.commission_mensuelle > 0 ? euros(r.commission_mensuelle) + "/m" : r.part_fixe > 0 ? euros(r.part_fixe) : "—"}
              </span>
            </button>
          )
        })}
      </div>

      {courant && (
        <div className="fixed inset-0 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,.55)' }} onClick={() => setOuvert(null)}>
          <div className="w-full max-w-lg rounded-xl p-5" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="font-semibold">{courant.company ?? courant.email}</div>
                <div className="text-[12px]" style={{ color: 'var(--color-muted)' }}>{jour(courant.scheduled_at)}</div>
              </div>
              <button onClick={() => setOuvert(null)} className="p-1 rounded hover:bg-white/5"><X size={16} /></button>
            </div>

            <div className="flex flex-col gap-1 mb-4 text-[12px]" style={{ color: 'var(--color-muted)' }}>
              {courant.phone && <span className="flex items-center gap-2"><Phone size={12} />{courant.phone}</span>}
              {courant.email && <span className="flex items-center gap-2"><Mail size={12} />{courant.email}</span>}
              {courant.city && <span className="flex items-center gap-2"><MapPin size={12} />{courant.city}</span>}
            </div>

            <div className="text-[11px] uppercase font-semibold mb-2" style={{ color: 'var(--color-muted-2)' }}>Comment s&apos;est passé ce rendez-vous ?</div>
            <div className="grid grid-cols-2 gap-2 mb-4">
              {ETAPES.map(e => {
                const actif = (courant.crm_stage ?? 'a_venir') === e.key
                return (
                  <button
                    key={e.key}
                    onClick={() => void patch(courant.id, { crmStage: e.key })}
                    className="rounded-lg px-3 py-2 text-left"
                    style={{
                      border: `1px solid ${actif ? e.color : 'var(--color-border)'}`,
                      background: actif ? e.color + '1a' : 'transparent',
                    }}
                  >
                    <div className="text-[13px] font-medium flex items-center justify-between" style={{ color: actif ? e.color : 'var(--color-text)' }}>
                      {e.label}{e.badge && <span className="text-[11px]">{e.badge}</span>}
                    </div>
                    <div className="text-[10px] mt-0.5" style={{ color: 'var(--color-muted-2)' }}>{e.aide}</div>
                  </button>
                )
              })}
            </div>

            {courant.crm_stage === 'non_qualifie' && (
              <div className="mb-4">
                <div className="text-[11px] uppercase font-semibold mb-2" style={{ color: 'var(--color-muted-2)' }}>Pourquoi ?</div>
                <div className="flex flex-wrap gap-2">
                  {MOTIFS.map(mo => (
                    <button
                      key={mo.key}
                      onClick={() => void patch(courant.id, { unqualifiedReason: mo.key })}
                      className="text-[12px] px-2.5 py-1 rounded-full"
                      style={{
                        border: `1px solid ${courant.unqualified_reason === mo.key ? '#9a6b6b' : 'var(--color-border)'}`,
                        color: courant.unqualified_reason === mo.key ? '#9a6b6b' : 'var(--color-muted)',
                      }}
                    >{mo.label}</button>
                  ))}
                </div>
              </div>
            )}

            {/* L'abonnement n'est demandé QUE si le client a signé. Et une fin d'abonnement se DATE,
                elle ne s'efface pas : sinon les factures des mois déjà prélevés changeraient. */}
            {courant.crm_stage === 'signe' && (
              <div className="mb-4">
                <div className="text-[11px] uppercase font-semibold mb-2 flex items-center gap-1" style={{ color: 'var(--color-muted-2)' }}>
                  <Euro size={11} /> Ce que ce client te paie chaque mois (HT)
                </div>
                <input
                  type="text"
                  inputMode="decimal"
                  defaultValue={courant.montant_mensuel ?? ''}
                  placeholder="ex. 500"
                  onBlur={e => void patch(courant.id, { montantMensuel: e.target.value })}
                  className="w-full px-3 py-2 rounded-md text-sm"
                  style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
                />
                <div className="text-[11px] mt-2" style={{ color: courant.client_actif ? '#5c9b82' : 'var(--color-muted-2)' }}>
                  {courant.client_actif
                    ? <>Commission 5 % : <strong>{euros((courant.montant_mensuel ?? 0) * 0.05)} par mois</strong>, tant qu'il reste client.</>
                    : <>Abonnement terminé — plus aucune commission. Les mois déjà facturés restent inchangés.</>}
                </div>

                <div className="text-[11px] uppercase font-semibold mt-4 mb-2" style={{ color: 'var(--color-muted-2)' }}>
                  Il n'est plus client depuis le
                </div>
                <input
                  type="date"
                  defaultValue={courant.client_actif_jusqu_a ?? ''}
                  onChange={e => void patch(courant.id, { clientActifJusquA: e.target.value })}
                  className="w-full px-3 py-2 rounded-md text-sm"
                  style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
                />
                <div className="text-[10px] mt-1" style={{ color: 'var(--color-muted-2)' }}>
                  Laisse vide tant qu'il est client. En indiquant une date, la commission s'arrête ce
                  jour-là — les prélèvements passés ne sont jamais modifiés.
                </div>
              </div>
            )}

            <div className="text-[11px] uppercase font-semibold mb-2" style={{ color: 'var(--color-muted-2)' }}>Note</div>
            <textarea
              defaultValue={courant.client_note ?? ''}
              rows={2}
              placeholder="Ce qui s'est dit, la suite à donner…"
              onBlur={e => void patch(courant.id, { clientNote: e.target.value })}
              className="w-full px-3 py-2 rounded-md text-sm"
              style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
            />
          </div>
        </div>
      )}
    </div>
  )
}

function Case({ label, valeur, couleur, fort }: { label: string; valeur: string; couleur?: string; fort?: boolean }) {
  return (
    <div className="rounded-lg px-3 py-2.5" style={{ border: `1px solid ${fort ? '#5c9b82' : 'var(--color-border)'}`, background: 'var(--color-surface-2)' }}>
      <div className="text-[10px] uppercase" style={{ color: 'var(--color-muted-2)' }}>{label}</div>
      <div className="text-lg font-semibold" style={{ color: couleur ?? 'var(--color-text)' }}>{valeur}</div>
    </div>
  )
}

function Onglet({ actif, onClick, label, couleur }: { actif: boolean; onClick: () => void; label: string; couleur: string }) {
  return (
    <button
      onClick={onClick}
      className="text-[12px] px-3 py-1.5 rounded-full"
      style={{
        border: `1px solid ${actif ? couleur : 'var(--color-border)'}`,
        background: actif ? couleur + '1a' : 'transparent',
        color: actif ? couleur : 'var(--color-muted)',
      }}
    >{label}</button>
  )
}
