export default function Dashboard() {
  const stats = [
    { label: 'Prospects total',   value: '—' },
    { label: 'Emails envoyés',    value: '—' },
    { label: 'Taux d\'ouverture', value: '—' },
    { label: 'Taux de réponse',   value: '—' },
    { label: 'RDV générés',       value: '—' },
    { label: 'Séquences actives', value: '—' },
  ]

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-8">
        <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>
          Vue d&apos;ensemble
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>
          Agent de cold emailing — couvreurs France
        </p>
      </div>

      <div className="grid grid-cols-3 gap-px mb-8"
        style={{ background: 'var(--color-border)', border: '1px solid var(--color-border)', borderRadius: '8px', overflow: 'hidden' }}
      >
        {stats.map(({ label, value }) => (
          <div key={label} className="px-5 py-4" style={{ background: 'var(--color-surface)' }}>
            <p className="text-2xl font-semibold mb-1" style={{ color: 'var(--color-text)' }}>
              {value}
            </p>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Section title="Activité récente">
          <Empty text="Aucune activité pour le moment" />
        </Section>

        <Section title="Leads chauds">
          <Empty text="Aucun lead en cours" />
        </Section>
      </div>

      <div className="mt-4">
        <Section title="Pipeline">
          <div className="flex gap-2 flex-wrap py-1">
            {['Nouveau','Contacté','Réponse','Intéressé','RDV réservé','Plus tard','Pas intéressé'].map(label => (
              <div
                key={label}
                className="flex items-center gap-2 px-3 py-1.5 rounded-md text-xs"
                style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}
              >
                {label}
                <span className="font-semibold" style={{ color: 'var(--color-text)' }}>0</span>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
      <div className="px-4 py-3" style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
        <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{title}</p>
      </div>
      <div className="p-4" style={{ background: 'var(--color-surface)' }}>
        {children}
      </div>
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return (
    <p className="text-sm py-4 text-center" style={{ color: 'var(--color-muted)' }}>{text}</p>
  )
}
