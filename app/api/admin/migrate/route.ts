import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'

export const maxDuration = 60

/**
 * MIGRATIONS IDEMPOTENTES (ALTER TABLE ... IF NOT EXISTS uniquement).
 *
 * Le projet n'avait aucun mécanisme de migration : le schéma était poussé via drizzle depuis un
 * poste, ce qui suppose d'avoir DATABASE_URL en local (il est vide, les secrets ne vivent que sur
 * Vercel). Cet endpoint permet d'appliquer une évolution de schéma depuis la prod, sans rien
 * détruire. ⚠️ Toujours lancer la migration AVANT de déployer le code qui utilise la colonne.
 *
 * GET /api/admin/migrate?key=<CRON_SECRET>
 */
export async function GET(request: NextRequest) {
  const auth = checkCronAuth(request)
  if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { db } = await import('@/lib/db')
  const { sql } = await import('drizzle-orm')

  const migrations: Array<{ nom: string; run: () => Promise<unknown> }> = [
    {
      // Suivi de la commission de 5 % sur le CA apporté (facture FA-2026-07-03) : le client
      // marque le RDV comme signé et renseigne le CA HT encaissé, au fil des encaissements.
      nom: 'rdv: add ca_ht',
      run: () => db.execute(sql`ALTER TABLE rdv ADD COLUMN IF NOT EXISTS ca_ht NUMERIC(12,2)`),
    },
    {
      nom: 'rdv: add signed_at',
      run: () => db.execute(sql`ALTER TABLE rdv ADD COLUMN IF NOT EXISTS signed_at TIMESTAMP`),
    },
    {
      nom: 'rdv: add client_name',
      run: () => db.execute(sql`ALTER TABLE rdv ADD COLUMN IF NOT EXISTS client_note TEXT`),
    },
  ]

  const resultats: string[] = []
  for (const m of migrations) {
    try {
      await m.run()
      resultats.push(`OK   ${m.nom}`)
    } catch (err) {
      resultats.push(`ERR  ${m.nom} : ${String(err).slice(0, 120)}`)
    }
  }

  return NextResponse.json({ ok: true, resultats })
}
