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
      nom: 'contacts: add mv_last_attempt_at',
      run: () => db.execute(sql`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS mv_last_attempt_at TIMESTAMP`),
    },
    {
      nom: 'contacts: add mv_attempts',
      run: () => db.execute(sql`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS mv_attempts INTEGER DEFAULT 0`),
    },
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
    {
      // 🚨 AUDIT 09/08 — TABLE ÉCRITE MAIS INEXISTANTE.
      // poll-imap-replies insère ici la tâche « demande RGPD reçue, répondre sous 1 mois », avec
      // un `.catch(() => {})`. La table n'ayant jamais été créée, CHAQUE insertion échouait en
      // silence : l'alerte la plus importante du système (une demande RGPD à traiter dans un délai
      // légal) disparaissait sans laisser la moindre trace. Un `.catch` vide sur une écriture qui
      // porte une obligation légale est une faute en soi — mais l'absence de table la rendait
      // permanente.
      nom: 'urgent_tasks: create table',
      run: () => db.execute(sql`
        CREATE TABLE IF NOT EXISTS urgent_tasks (
          id          SERIAL PRIMARY KEY,
          type        TEXT NOT NULL,
          title       TEXT NOT NULL,
          description TEXT,
          contact_id  TEXT,
          done        BOOLEAN NOT NULL DEFAULT FALSE,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          done_at     TIMESTAMPTZ
        )
      `),
    },
    {
      nom: 'urgent_tasks: index type/date',
      run: () => db.execute(sql`CREATE INDEX IF NOT EXISTS urgent_tasks_type_idx ON urgent_tasks(type, created_at DESC)`),
    },
    {
      // Anti-doublon : une même demande RGPD relue deux fois ne doit pas empiler deux tâches.
      nom: 'urgent_tasks: unicite du titre',
      run: () => db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS urgent_tasks_title_uk ON urgent_tasks(title)`),
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
