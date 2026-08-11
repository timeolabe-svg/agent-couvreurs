'use client'

import { useEffect, useState } from 'react'
import { Upload, FileSpreadsheet, CheckCircle2, AlertTriangle } from 'lucide-react'

/**
 * PAGE D'IMPORT DE LEADS.
 *
 * ⚠️ Elle n'existait pas : le bouton « Importer » de la page Prospects renvoyait vers /leads, qui
 * n'a aucun champ fichier. Charger des leads — l'opération la plus banale du métier — nécessitait
 * donc quelqu'un d'autre.
 *
 * DEUX TEMPS OBLIGATOIRES : on ANALYSE, on montre le résultat, et l'import ne part qu'après un
 * second clic. Un fichier de 1 000 lignes engage des envois à 1 000 entreprises réelles ; on
 * regarde ce qu'on a AVANT, pas après.
 */
type Analyse = {
  ok: boolean
  mode?: string
  lignes_dans_le_fichier?: number
  colonnes_reconnues?: Record<string, string>
  colonnes_ignorees?: string[]
  ecartes?: Record<string, number>
  EXPLOITABLES?: number
  taux?: string
  charges_en_base?: number
  error?: string
  entetes_trouvees?: string[]
}

export default function ImportPage() {
  const [fichier, setFichier] = useState<File | null>(null)
  const [analyse, setAnalyse] = useState<Analyse | null>(null)
  const [enCours, setEnCours] = useState(false)
  const [importe, setImporte] = useState(false)

  /**
   * ⚠️ La page renvoyait « Unauthorized » sur TOUS les fichiers, et j'ai livré ça sans l'essayer.
   * L'endpoint est protégé par CRON_SECRET (c'est un point d'écriture : il crée des prospects qui
   * recevront de vrais mails), mais la page ne transmettait aucune clé. Elle ne pouvait donc pas
   * fonctionner une seule fois.
   *
   * On demande la clé une fois et on la garde dans le navigateur. Retirer la protection aurait été
   * plus simple — et aurait laissé n'importe qui injecter des destinataires dans la file d'envoi.
   */
  const [cle, setCle] = useState('')
  useEffect(() => { setCle(localStorage.getItem('cron_key') ?? '') }, [])
  function memoriser(v: string) { setCle(v); localStorage.setItem('cron_key', v) }

  async function envoyer(importer: boolean) {
    if (!fichier) return
    setEnCours(true)
    try {
      const fd = new FormData()
      fd.append('fichier', fichier)
      const q = new URLSearchParams()
      if (importer) q.set('importer', '1')
      if (cle) q.set('key', cle)
      const r = await fetch(`/api/admin/import-fichier?${q.toString()}`, { method: 'POST', body: fd })
      const d = (await r.json()) as Analyse
      setAnalyse(d)
      if (importer && d.ok) setImporte(true)
    } catch (e) {
      setAnalyse({ ok: false, error: String(e).slice(0, 200) })
    } finally {
      setEnCours(false)
    }
  }

  const ec = analyse?.ecartes ?? {}
  const libelles: Record<string, string> = {
    sans_nom: 'Lignes sans nom d\'entreprise',
    concurrents: 'Agences web / com (concurrents)',
    fermees_definitivement: 'Entreprises fermées (Google)',
    hors_metier: 'Hors métier (hôtels, spas, clubs…)',
    deja_en_base: 'Déjà connus',
    moins_de_20_avis: 'Moins de 20 avis Google',
    sans_site_web: 'Sans site internet',
  }

  return (
    <div className="p-8 max-w-3xl">
      <h1 className="text-lg font-semibold mb-1" style={{ color: 'var(--color-text)' }}>Importer des leads</h1>
      <p className="text-sm mb-6" style={{ color: 'var(--color-muted)' }}>
        Excel ou CSV. Le fichier est d&apos;abord analysé — rien n&apos;est importé tant que tu n&apos;as pas confirmé.
      </p>

      <label
        className="flex flex-col items-center justify-center gap-3 p-10 rounded-lg cursor-pointer transition-colors"
        style={{ border: '2px dashed var(--color-border)', background: 'var(--color-surface-2)' }}
      >
        <Upload size={28} style={{ color: 'var(--color-muted-2)' }} />
        <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
          {fichier ? fichier.name : 'Choisir un fichier .xlsx ou .csv'}
        </span>
        {fichier && (
          <span className="text-xs" style={{ color: 'var(--color-muted-2)' }}>
            {(fichier.size / 1024).toFixed(0)} Ko
          </span>
        )}
        <input
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={e => { setFichier(e.target.files?.[0] ?? null); setAnalyse(null); setImporte(false) }}
        />
      </label>

      <div className="mt-4">
        <label className="block text-xs mb-1" style={{ color: 'var(--color-muted-2)' }}>
          Clé d&apos;accès (CRON_SECRET) — retenue sur cet appareil
        </label>
        <input
          type="password"
          value={cle}
          onChange={e => memoriser(e.target.value)}
          placeholder="clé"
          className="w-full px-3 py-2 rounded-md text-sm"
          style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
        />
      </div>

      {fichier && !importe && (
        <button
          onClick={() => envoyer(false)}
          disabled={enCours}
          className="mt-4 px-4 py-2 rounded-md text-sm font-medium"
          style={{ background: 'var(--color-accent)', color: '#fff', opacity: enCours ? 0.6 : 1 }}
        >
          {enCours ? 'Analyse en cours…' : 'Analyser le fichier'}
        </button>
      )}

      {analyse && !analyse.ok && (
        <div className="mt-6 p-4 rounded-lg text-sm" style={{ background: 'rgba(224,163,62,0.1)', border: '1px solid #e0a33e', color: 'var(--color-text)' }}>
          <div className="flex items-center gap-2 font-medium mb-1"><AlertTriangle size={14} /> {analyse.error}</div>
          {analyse.entetes_trouvees && (
            <div className="text-xs mt-2" style={{ color: 'var(--color-muted)' }}>
              Colonnes trouvées : {analyse.entetes_trouvees.join(', ')}
            </div>
          )}
        </div>
      )}

      {analyse?.ok && (
        <div className="mt-6 rounded-lg overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
          <div className="px-4 py-3 flex items-center justify-between" style={{ background: 'var(--color-surface-2)' }}>
            <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
              {analyse.lignes_dans_le_fichier} lignes lues
            </span>
            <span className="text-sm font-semibold" style={{ color: 'var(--color-accent)' }}>
              {analyse.EXPLOITABLES} exploitables ({analyse.taux})
            </span>
          </div>

          <div className="px-4 py-3">
            <div className="text-xs uppercase font-semibold mb-2" style={{ color: 'var(--color-muted-2)' }}>Écartés</div>
            {Object.entries(ec).filter(([, n]) => n > 0).map(([k, n]) => (
              <div key={k} className="flex justify-between text-sm py-1" style={{ color: 'var(--color-muted)' }}>
                <span>{libelles[k] ?? k}</span><span>{n}</span>
              </div>
            ))}
            {Object.values(ec).every(n => n === 0) && (
              <div className="text-sm" style={{ color: 'var(--color-muted)' }}>Aucun écarté.</div>
            )}

            {analyse.colonnes_ignorees && analyse.colonnes_ignorees.length > 0 && (
              <div className="mt-3 text-xs" style={{ color: 'var(--color-muted-2)' }}>
                Colonnes ignorées : {analyse.colonnes_ignorees.join(', ')}
              </div>
            )}
          </div>

          <div className="px-4 py-3" style={{ borderTop: '1px solid var(--color-border)' }}>
            {importe ? (
              <div className="flex items-center gap-2 text-sm" style={{ color: '#5c9b82' }}>
                <CheckCircle2 size={15} />
                {analyse.charges_en_base} leads chargés. L&apos;agent va scraper leur email puis les mettre en file.
              </div>
            ) : (
              <button
                onClick={() => envoyer(true)}
                disabled={enCours || !analyse.EXPLOITABLES}
                className="px-4 py-2 rounded-md text-sm font-medium flex items-center gap-2"
                style={{ background: analyse.EXPLOITABLES ? 'var(--color-accent)' : 'var(--color-surface-2)', color: analyse.EXPLOITABLES ? '#fff' : 'var(--color-muted-2)' }}
              >
                <FileSpreadsheet size={14} />
                {enCours ? 'Import…' : `Importer les ${analyse.EXPLOITABLES} leads`}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
