'use client'

import { useEffect, useState } from 'react'
import { Phone, Globe, MapPin, RefreshCw, Cpu, Mail, Inbox, ChevronLeft } from 'lucide-react'

interface ConvMessage {
  role: 'sent' | 'received' | 'agent'
  subject?: string
  body: string
  date: string
  status?: string
  classification?: string
}
interface Conversation {
  key: string
  contactId: string | null
  company: string
  email: string
  city: string
  phone: string | null
  website: string | null
  classification: string | null
  rdvBooked?: boolean
  /** Le prospect a écrit et n'a pas eu de réponse : la conversation demande une action. */
  prospectAttend?: boolean
  /** Date de retour annoncée (fermeture, congés) — range la conversation dans « Absents ». */
  absentJusquAu?: string | null
  exhausted?: boolean // plus aucune relance ni brouillon à venir → conversation morte
  messages: ConvMessage[]
  lastDate: string
}

const CLASS_LABEL: Record<string, { label: string; color: string }> = {
  interest: { label: 'Intéressé', color: '#5c9b82' },
  rdv_request: { label: 'RDV', color: '#5c9b82' },
  question: { label: 'Question', color: '#5f83ac' },
  objection: { label: 'Objection', color: '#c19653' },
  desinterest: { label: 'Pas intéressé', color: '#ef4444' },
  oof: { label: 'Auto/Absence', color: '#6b7280' },
  spam: { label: 'Spam', color: '#6b7280' },
  other: { label: 'Autre', color: '#7d6fb0' },
}

function fmt(d: string): string {
  if (!d) return ''
  const date = new Date(d)
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

type Tab = 'positive' | 'negative' | 'pending' | 'absent' | 'failed'

// Range une conversation dans un des 4 onglets :
//  - Positives   = un RDV est calé (l'objectif atteint).
//  - Négatives   = opt-out "stop" OU échange terminé où le lead décline (desinterest).
//  - En attente  = l'agent échange encore avec le lead (quelque chose est encore prévu).
//  - Échoué      = plus AUCUNE relance ni réponse à venir et toujours pas de RDV : la
//                  conversation est morte, elle ne doit plus polluer "En attente".
function tabOf(c: Conversation): Tab {
  /**
   * ⚠️ CE TEST PASSE AVANT TOUS LES AUTRES. Une conversation où le prospect a écrit sans obtenir de
   * réponse est ACTIONNABLE, quoi qu'il arrive par ailleurs — rendez-vous calé compris. Sans ça,
   * un prospect qui demande à décaler son rendez-vous se range dans « Positives » et n'est jamais vu.
   */
  // L'absence prime : il a donné une date, on le rappellera à cette date. Rien à faire aujourd'hui.
  if (c.absentJusquAu) return 'absent'
  if (c.prospectAttend) return 'pending'
  if (c.rdvBooked) return 'positive'
  if (c.classification === 'desinterest') return 'negative'
  if (c.exhausted) return 'failed'
  return 'pending' // interest sans RDV, question, objection, oof, other, non classé
}

const TABS: { key: Tab; label: string; color: string }[] = [
  { key: 'positive', label: 'Positives', color: '#5c9b82' },
  { key: 'negative', label: 'Négatives', color: '#ef4444' },
  { key: 'pending', label: 'En attente', color: '#c19653' },
  // ⚠️ « Absents » : les prospects qui ont annoncé une fermeture ou des congés AVEC une date de
  // retour. Ils n'étaient nulle part — ni ici, ni dans les négatives : la messagerie les masquait
  // comme des réponses automatiques. Or « rappelez-moi après le 25 » est un créneau donné.
  { key: 'absent', label: 'Absents', color: '#5f83ac' },
  { key: 'failed', label: 'Échoué', color: '#6b6b80' },
]

export default function ConversationsPage() {
  const [convs, setConvs] = useState<Conversation[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  /**
   * ⚠️ L'ÉCRAN S'OUVRAIT SUR « POSITIVES », QUI NE CONTIENT QUE LES RDV CALÉS.
   *
   * Mesuré le 18/08 : 9 personnes dans « Positives », 75 dans « En attente ». Timéo cherchait le
   * prospect qui demandait le prix et concluait qu'il n'était « nulle part dans le logiciel » — il
   * était là, dans l'onglet d'à côté. Un écran qui s'ouvre sur 7 % de son contenu fait croire que
   * le reste n'existe pas.
   *
   * On ouvre désormais sur « En attente » : c'est le seul onglet qui demande une action. Les RDV
   * déjà calés, eux, n'attendent rien de personne.
   */
  const [tab, setTab] = useState<Tab>('pending')

  const load = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/conversations')
      const json = await res.json() as { conversations: Conversation[] }
      setConvs(json.conversations ?? [])
    } catch { /* ignore */ }
    setLoading(false)
  }
  useEffect(() => { void load() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [])

  const counts: Record<Tab, number> = { positive: 0, negative: 0, pending: 0, absent: 0, failed: 0 }
  for (const c of convs) counts[tabOf(c)]++

  const filtered = convs.filter(c => tabOf(c) === tab)

  // Sélectionne automatiquement la 1ère conv de l'onglet actif
  useEffect(() => {
    if (filtered.length && !filtered.some(c => c.key === selected)) {
      setSelected(filtered[0].key)
    }
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [tab, convs])

  const current = filtered.find(c => c.key === selected) ?? null

  return (
    <div className="flex h-full" style={{ color: 'var(--color-text)' }}>
      {/*
        LISTE DES CONVERSATIONS — MAÎTRE / DÉTAIL SUR TÉLÉPHONE.

        ⚠️ La liste était figée à 320 px À CÔTÉ du fil, quelle que soit la taille de l'écran. Sur un
        téléphone de 375 px, il restait donc 55 px pour lire les messages : c'est ce que Timéo a vu.
        Deux panneaux côte à côte n'ont de sens que si l'écran est large.

        Sur mobile on affiche UN panneau à la fois : la liste, puis le fil quand on en ouvre un,
        avec un retour. À partir de md, on retrouve les deux côte à côte.
      */}
      <div
        className={`${current ? 'hidden' : 'flex'} md:flex w-full md:w-80 flex-shrink-0 flex-col h-full`}
        style={{ borderRight: '1px solid var(--color-border)' }}
      >
        <div className="h-14 px-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <div className="flex items-center gap-2">
            <Inbox size={16} />
            <span className="font-semibold text-sm">Messagerie</span>
            <span className="text-[11px] px-1.5 py-0.5 rounded-full" style={{ background: 'var(--color-surface-2)', color: 'var(--color-muted)' }}>
              {convs.length}
            </span>
          </div>
          <button onClick={() => void load()} className="p-1.5 rounded hover:bg-white/5" title="Rafraîchir">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* Sous-onglets : Positives / Négatives / En attente / Échoué.
            4 onglets dans 320px → libellé sur une seule ligne (nowrap) + compteur compact,
            sinon "En attente" passait à la ligne et "Échoué" débordait. */}
        <div className="flex" style={{ borderBottom: '1px solid var(--color-border)' }}>
          {TABS.map(t => {
            const active = tab === t.key
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className="flex-1 min-w-0 px-1 py-2 flex flex-col items-center justify-center gap-0.5 transition-colors"
                style={{
                  color: active ? t.color : 'var(--color-muted)',
                  borderBottom: active ? `2px solid ${t.color}` : '2px solid transparent',
                  background: active ? 'var(--color-surface-2)' : 'transparent',
                }}
              >
                <span className="text-[11px] font-medium whitespace-nowrap leading-none">{t.label}</span>
                <span
                  className="text-[10px] px-1.5 rounded-full font-semibold leading-tight"
                  style={{ background: active ? t.color + '22' : 'var(--color-surface-2)', color: active ? t.color : 'var(--color-muted-2)' }}
                >
                  {counts[t.key]}
                </span>
              </button>
            )
          })}
        </div>

        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 && !loading && (
            <p className="text-[13px] p-4" style={{ color: 'var(--color-muted)' }}>
              {tab === 'positive' ? 'Aucune réponse positive pour le moment.'
                : tab === 'negative' ? 'Aucune réponse négative.'
                : tab === 'absent' ? "Personne n'a annoncé de fermeture ou de congés."
                : tab === 'failed' ? 'Aucune conversation épuisée.'
                : 'Rien en attente.'}
            </p>
          )}
          {filtered.map(c => {
            const cls = c.rdvBooked
              ? { label: 'RDV calé', color: '#5c9b82' }
              : (c.exhausted && c.classification !== 'desinterest')
              ? { label: 'Relances épuisées', color: '#6b6b80' }
              : (c.classification ? CLASS_LABEL[c.classification] : null)
            const last = c.messages[c.messages.length - 1]
            const active = c.key === selected
            return (
              <button
                key={c.key}
                onClick={() => setSelected(c.key)}
                className="w-full text-left px-4 py-3 flex flex-col gap-1"
                style={{
                  borderBottom: '1px solid var(--color-border)',
                  background: active ? 'var(--color-surface-2)' : 'transparent',
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-medium truncate">{c.company}</span>
                  <span className="text-[10px] flex-shrink-0" style={{ color: 'var(--color-muted-2)' }}>{fmt(c.lastDate)}</span>
                </div>
                {/* La date de retour est LE seul renseignement utile sur un absent : sans elle,
                    l'onglet ne dit pas quand rappeler. En rouge quand elle est déjà passée — c'est
                    un créneau qu'on a laissé filer, pas une information neutre. */}
                {c.absentJusquAu && (
                  <span
                    className="text-[10px] font-medium"
                    style={{ color: new Date(c.absentJusquAu) < new Date() ? '#ef4444' : '#5f83ac' }}
                  >
                    {new Date(c.absentJusquAu) < new Date() ? '⚠ ' : ''}
                    De retour le {new Date(c.absentJusquAu).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}
                    {new Date(c.absentJusquAu) < new Date() ? ' — à recontacter' : ''}
                  </span>
                )}
                <div className="flex items-center gap-2">
                  {cls && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold flex-shrink-0" style={{ background: cls.color + '22', color: cls.color }}>
                      {cls.label}
                    </span>
                  )}
                  <span className="text-[11px] truncate" style={{ color: 'var(--color-muted)' }}>
                    {last?.role === 'agent' ? '↩ ' : last?.role === 'received' ? '← ' : '→ '}
                    {last?.body?.slice(0, 50)}
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Fil de la conversation — sur mobile il remplace la liste (voir ci-dessus). */}
      <div className={`${current ? 'flex' : 'hidden'} md:flex flex-1 flex-col h-full min-w-0`}>
        {!current ? (
          <div className="flex-1 flex items-center justify-center" style={{ color: 'var(--color-muted)' }}>
            <p className="text-sm">Sélectionne une conversation</p>
          </div>
        ) : (
          <>
            <div className="h-auto px-4 md:px-6 py-3 flex flex-col gap-1" style={{ borderBottom: '1px solid var(--color-border)' }}>
              {/* Retour à la liste — indispensable sur mobile, où le fil REMPLACE la liste : sans
                  ce bouton on ouvre une conversation et on ne peut plus en sortir. */}
              <button
                onClick={() => setSelected(null)}
                className="md:hidden flex items-center gap-1 text-[12px] mb-1 self-start"
                style={{ color: 'var(--color-accent)' }}
              >
                <ChevronLeft size={14} /> Toutes les conversations
              </button>
              <span className="font-semibold text-[15px] break-words">{current.company}</span>
              {/* Les coordonnées passent à la ligne au lieu de déborder de l'écran. */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]" style={{ color: 'var(--color-muted)' }}>
                <span className="flex items-center gap-1"><Mail size={12} />{current.email}</span>
                {current.city && <span className="flex items-center gap-1"><MapPin size={12} />{current.city}</span>}
                {current.phone && (
                  <a href={`tel:${current.phone}`} className="flex items-center gap-1 font-medium" style={{ color: '#5c9b82' }}>
                    <Phone size={12} />{current.phone}
                  </a>
                )}
                {current.website && (
                  <a href={current.website.startsWith('http') ? current.website : `https://${current.website}`} target="_blank" rel="noreferrer" className="flex items-center gap-1" style={{ color: 'var(--color-accent)' }}>
                    <Globe size={12} />site
                  </a>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-3 md:px-6 py-4 flex flex-col gap-3">
              {current.messages.map((m, i) => {
                const isOut = m.role === 'sent' || m.role === 'agent'
                // 🚨 UN BROUILLON N'EST PAS UN MESSAGE ENVOYÉ (correctif 09/08).
                // Le fil dessinait une réponse en attente de validation EXACTEMENT comme une réponse
                // partie : même bulle, même côté, avec pour seule différence un « · pending » en gris
                // 10 px. Timéo a logiquement cru que l'agent avait écrit au prospect sans son accord.
                // Le danger est en réalité SYMÉTRIQUE, et le second cas est le pire : un brouillon
                // qui a l'air envoyé ne sera jamais validé — donc le prospect n'aura JAMAIS de
                // réponse, et personne ne s'en apercevra. C'est la mécanique du lead oublié.
                // Un état qui change ce qui va se passer doit se voir au premier coup d'œil.
                const enAttente = m.role === 'agent' && m.status !== 'sent'
                const aValider = m.role === 'agent' && (m.status === 'pending' || m.status === 'awaiting_validation')
                /**
                 * ⚠️ « Réponse envoyée » ÉTAIT LE CAS PAR DÉFAUT — et c'est ainsi qu'un brouillon
                 * REJETÉ s'affichait comme parti (constaté le 17/08/2026).
                 *
                 * Cas réel : un couvreur du Cannet propose « je vous donne 20 % de mon bénéfice ».
                 * Le brouillon de réponse finit en statut 'rejected', donc rien ne part — mais
                 * l'écran annonce « Réponse envoyée · 7 août, 18:45 », avec le texte complet sous
                 * les yeux. Dix jours plus tard le prospect attend toujours, et personne ne peut
                 * s'en douter : la négociation la plus chaude de la semaine, perdue par un libellé.
                 *
                 * Un état inconnu doit se dire inconnu. On n'affiche « envoyée » que pour 'sent',
                 * et tout autre statut est nommé explicitement — quitte à afficher un mot technique.
                 */
                const libelle = m.role === 'sent'
                  ? 'Email envoyé'
                  : m.role === 'agent'
                    ? (aValider ? 'BROUILLON — PAS ENVOYÉ, attend ta validation'
                      : m.status === 'scheduled' ? 'Réponse programmée — partira automatiquement'
                      : m.status === 'sent' ? 'Réponse envoyée'
                      : m.status === 'rejected' ? 'REJETÉ — jamais envoyé, le prospect attend'
                      : m.status === 'failed' ? 'ÉCHEC D\'ENVOI — le prospect n\'a rien reçu'
                      : `PAS ENVOYÉ (${m.status ?? 'état inconnu'})`)
                    : 'Reçu'
                return (
                  <div key={i} className="flex flex-col" style={{ alignItems: isOut ? 'flex-end' : 'flex-start' }}>
                    <div className="flex items-center gap-2 mb-1">
                      {m.role === 'agent' && <Cpu size={11} style={{ color: aValider ? '#e0a33e' : 'var(--color-accent)' }} />}
                      <span
                        className="text-[10px]"
                        style={{ color: aValider ? '#e0a33e' : 'var(--color-muted-2)', fontWeight: aValider ? 600 : 400 }}
                      >
                        {libelle} · {fmt(m.date)}
                      </span>
                    </div>
                    <div
                      /* 92 % sur téléphone : à 80 % d'un écran de 375 px, une bulle fait 300 px et
                         chaque phrase se casse en trois. break-words coupe les longues URL au lieu
                         de pousser la bulle au-delà de l'écran. */
                      className="max-w-[92%] md:max-w-[80%] rounded-lg px-3 py-2 text-[13px] whitespace-pre-wrap break-words leading-relaxed"
                      style={{
                        background: m.role === 'received'
                          ? 'var(--color-surface-2)'
                          : aValider ? 'transparent'
                          : m.role === 'agent' ? 'var(--color-accent)' + '18'
                          : 'var(--color-surface)',
                        // Contour en pointillés + teinte ambre : la convention universelle du
                        // « pas encore acté ». Visible sans lire une seule étiquette.
                        border: aValider ? '1px dashed #e0a33e' : '1px solid var(--color-border)',
                        borderLeft: m.role === 'agent' && !aValider ? '2px solid var(--color-accent)' : undefined,
                        opacity: enAttente && !aValider ? 0.85 : 1,
                      }}
                    >
                      {m.subject && <div className="font-semibold mb-1 text-[12px]" style={{ color: 'var(--color-muted)' }}>{m.subject}</div>}
                      {m.body}
                      {aValider && (
                        <div className="mt-2 pt-2 text-[11px]" style={{ borderTop: '1px dashed #e0a33e', color: '#e0a33e' }}>
                          Ce texte n&apos;a PAS été envoyé. Va dans « À valider » pour l&apos;envoyer, le corriger ou le rejeter.
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
