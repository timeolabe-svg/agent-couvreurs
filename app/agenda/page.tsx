import { DEMO_RDV } from '@/data/demo'
import { Calendar, Phone, CheckCircle, Mail } from 'lucide-react'
import Link from 'next/link'

const HOURS = Array.from({ length: 11 }, (_, i) => i + 8)
const DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven']

function getWeekDays() {
  // Semaine du 4 mai 2026 (où se trouve le RDV)
  const monday = new Date('2026-05-04')
  return Array.from({ length: 5 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    return d
  })
}

export default function AgendaPage() {
  const weekDays = getWeekDays()

  return (
    <div className="flex flex-col h-full">
      <div
        className="px-6 h-14 flex items-center justify-between flex-shrink-0"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <div className="flex items-center gap-3">
          <h1 className="text-[13px] font-semibold" style={{ color: 'var(--color-text)' }}>Agenda</h1>
          <span
            className="text-[11px] px-2 py-0.5 rounded"
            style={{ background: '#22c55e15', color: '#22c55e', border: '1px solid #22c55e30' }}
          >
            {DEMO_RDV.length} RDV ce mois
          </span>
        </div>
        <p className="text-[12px]" style={{ color: 'var(--color-muted)' }}>
          Semaine du 4 mai — 8 mai 2026
        </p>
      </div>

      <div className="flex-1 overflow-auto flex flex-col">
        <div className="flex flex-col flex-1">
          {/* Day headers */}
          <div className="flex" style={{ borderBottom: '1px solid var(--color-border)' }}>
            <div className="w-14 flex-shrink-0" />
            {weekDays.map((d, i) => {
              const hasRdv = DEMO_RDV.some(r => d.toISOString().startsWith(r.date))
              return (
                <div
                  key={i}
                  className="flex-1 px-3 py-2 text-center"
                  style={{ borderLeft: '1px solid var(--color-border)' }}
                >
                  <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>{DAYS[i]}</p>
                  <p className="text-[13px] font-medium" style={{ color: 'var(--color-text)' }}>
                    {d.getDate()}
                  </p>
                  {hasRdv && (
                    <div className="w-1.5 h-1.5 rounded-full mx-auto mt-0.5" style={{ background: '#22c55e' }} />
                  )}
                </div>
              )
            })}
          </div>

          {/* Time slots */}
          <div className="flex flex-1 overflow-auto">
            <div className="w-14 flex-shrink-0">
              {HOURS.map(h => (
                <div
                  key={h}
                  className="h-14 flex items-start justify-end pr-2 pt-1"
                  style={{ borderBottom: '1px solid var(--color-border)' }}
                >
                  <span className="text-[10px]" style={{ color: 'var(--color-muted-2)' }}>{h}h</span>
                </div>
              ))}
            </div>

            {weekDays.map((d, di) => {
              const dayRdvs = DEMO_RDV.filter(r => d.toISOString().startsWith(r.date))
              return (
                <div
                  key={di}
                  className="flex-1 relative"
                  style={{ borderLeft: '1px solid var(--color-border)' }}
                >
                  {HOURS.map(h => (
                    <div
                      key={h}
                      className="h-14"
                      style={{ borderBottom: '1px solid var(--color-border)' }}
                    />
                  ))}

                  {dayRdvs.map(r => {
                    const [hh, mm] = r.time.split(':').map(Number)
                    const topOffset = ((hh - 8) * 56) + (mm / 60 * 56)
                    const heightPx = (r.duration / 60) * 56

                    return (
                      <Link key={r.id} href={`/leads/${r.leadId}`}>
                        <div
                          className="absolute left-1 right-1 rounded-md px-2 py-1.5 cursor-pointer"
                          style={{
                            top: topOffset,
                            height: Math.max(heightPx, 44),
                            background: '#22c55e15',
                            border: '1px solid #22c55e40',
                          }}
                        >
                          <p className="text-[11px] font-medium leading-tight" style={{ color: '#22c55e' }}>
                            {r.company}
                          </p>
                          <p className="text-[10px]" style={{ color: 'var(--color-muted)' }}>
                            {r.time} · {r.contact}
                          </p>
                        </div>
                      </Link>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* RDV cards */}
      <div
        className="flex-shrink-0 p-4"
        style={{ borderTop: '1px solid var(--color-border)', background: 'var(--color-surface)' }}
      >
        <p className="text-[11px] font-medium mb-3" style={{ color: 'var(--color-muted)' }}>
          RDV CETTE SEMAINE — {DEMO_RDV.length} confirmés
        </p>
        <div className="flex flex-col gap-2">
          {DEMO_RDV.map(rdv => {
            const rdvDate = new Date(`${rdv.date}T${rdv.time}`)
            return (
              <div
                key={rdv.id}
                className="rounded-lg p-3 flex items-start gap-3"
                style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}
              >
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: '#22c55e15', border: '1px solid #22c55e30' }}
                >
                  <Calendar size={13} style={{ color: '#22c55e' }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="text-[12px] font-semibold" style={{ color: 'var(--color-text)' }}>
                      {rdv.company}
                    </p>
                    <span className="text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1"
                      style={{ background: '#22c55e15', color: '#22c55e' }}>
                      <CheckCircle size={9} />
                      Confirmé par agent
                    </span>
                  </div>
                  <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>
                    {rdvDate.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })} à {rdv.time} · {rdv.duration} min
                  </p>
                  <div className="flex items-center gap-3 mt-1">
                    {rdv.phone && (
                      <span className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--color-muted)' }}>
                        <Phone size={10} />
                        {rdv.phone}
                      </span>
                    )}
                    <span className="flex items-center gap-1 text-[10px]" style={{ color: '#22c55e' }}>
                      <Mail size={10} />
                      Client notifié
                    </span>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-[10px]" style={{ color: 'var(--color-muted-2)' }}>Détecté depuis :</p>
                  <p className="text-[10px] italic max-w-40 text-right mt-0.5" style={{ color: 'var(--color-muted-2)' }}>
                    &ldquo;{rdv.detectedFrom}&rdquo;
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
