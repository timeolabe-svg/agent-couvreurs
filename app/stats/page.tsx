export default function StatsPage() {
  const kpis = [
    { label: 'Emails envoyes',    value: '—', note: 'Total cumulé' },
    { label: 'Taux d\'ouverture', value: '—', note: 'Objectif > 50%' },
    { label: 'Taux de reponse',   value: '—', note: 'Objectif > 15%' },
    { label: 'Taux conversion',   value: '—', note: 'Reponse → RDV' },
    { label: 'RDV generes',       value: '—', note: 'Total' },
    { label: 'Cout par RDV',      value: '—', note: 'vs Google Ads ~85€' },
  ]

  return (
    <div className="flex h-full flex-col">
      <div className="px-8 h-14 flex items-center flex-shrink-0"
        style={{ borderBottom: '1px solid var(--color-border)' }}>
        <h1 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Statistiques</h1>
      </div>

      <div className="flex-1 overflow-auto px-8 py-6 max-w-5xl">
        <div className="grid grid-cols-3 gap-px mb-8"
          style={{ background: 'var(--color-border)', border: '1px solid var(--color-border)', borderRadius: '8px', overflow: 'hidden' }}>
          {kpis.map(({ label, value, note }) => (
            <div key={label} className="px-5 py-5" style={{ background: 'var(--color-surface)' }}>
              <p className="text-3xl font-semibold mb-1" style={{ color: 'var(--color-text)' }}>{value}</p>
              <p className="text-xs mb-0.5" style={{ color: 'var(--color-muted)' }}>{label}</p>
              <p className="text-xs" style={{ color: 'var(--color-muted-2)' }}>{note}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <ChartPlaceholder title="Activite par semaine" />
          <ChartPlaceholder title="Entonnoir de conversion" />
        </div>

        <div>
          <p className="text-xs font-medium mb-3" style={{ color: 'var(--color-muted)' }}>PERFORMANCES PAR CAMPAGNE</p>
          <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                  {['Campagne', 'Envoyes', 'Ouverture', 'Reponse', 'RDV'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium"
                      style={{ background: 'var(--color-surface)', color: 'var(--color-muted)' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center">
                    <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
                      Aucune campagne lancee
                    </p>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

function ChartPlaceholder({ title }: { title: string }) {
  return (
    <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
      <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{title}</p>
      </div>
      <div className="flex items-center justify-center h-36">
        <p className="text-sm" style={{ color: 'var(--color-muted-2)' }}>Donnees insuffisantes</p>
      </div>
    </div>
  )
}
