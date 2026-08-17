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
    {
      /**
       * ⚠️ Le métier du prospect n'était NULLE PART dans le tampon d'import, et le passage en
       * contact écrivait `sector = 'terrassier'` EN DUR. Or `sector` pilote le vocabulaire du mail
       * généré (« ce prospect est un {sector} »). Chaque pisciniste recevait donc un message écrit
       * en jargon de terrassier — une erreur que le prospect lit, au nom du client.
       *
       * On conserve deux choses distinctes : `category` telle que Google la donne (brute, utile
       * pour rejouer un filtre a posteriori — impossible aujourd'hui puisqu'on ne la gardait pas),
       * et `sector` normalisé, celui qu'on écrira dans contacts.
       */
      /**
       * ⚠️ MÉMOIRE DE COUVERTURE — quelles combinaisons métier × ville ont DÉJÀ été achetées.
       *
       * Outscraper ne se souvient pas de ce qu'il a livré : relancer « pisciniste + Marseille »
       * rend les mêmes entreprises et les REFACTURE. Notre import jette bien les doublons (clé
       * `place_id`), donc l'argent est dépensé pour rien, sans que rien ne le signale.
       *
       * On enregistre donc ce qui a été ratissé, au moment de l'import, depuis la colonne `query`
       * du fichier (« pisciniste, 06001 CEDEX 1, Nice, Provence-Alpes-Côte d'Azur, FR »).
       * Sans trace écrite, la seule mémoire serait celle de Timéo — et elle ne tiendra pas trois
       * commandes.
       */
      /**
       * ⚠️ QUI A REJETÉ ? La question décide de tout ce qui suit.
       *
       * Le 17/08, Timéo rejette un brouillon dans « À valider ». Treize minutes plus tard, le
       * rattrapage en régénère un identique : pour lui, la machine passe outre son refus. Rien
       * n'était parti, mais l'effet est le même — il ne peut plus faire confiance à ce bouton.
       *
       * La cause : un rejet HUMAIN et un rejet SYSTÈME portent le même statut 'rejected'. Le
       * rattrapage, qui doit régénérer ce que la machine a raté, régénérait aussi ce que l'humain
       * avait volontairement écarté.
       *
       * Une décision humaine ne se rediscute pas. On trace donc son auteur.
       */
      /**
       * SUIVI DES RENDEZ-VOUS — le classement que Haris doit pouvoir faire lui-même.
       *
       * Barème Hdigiweb (différent de Revele) : 50 € par RDV qualifié + 5 % du CA généré. Le client
       * renseigne le montant qu'il encaisse réellement, et la commission se calcule seule.
       *
       * ⚠️ `crm_stage` est le classement de Haris, `status` reste l'état technique du rendez-vous
       * (confirmé, annulé). Les confondre reviendrait à laisser un classement commercial modifier
       * l'agenda — ou l'inverse.
       */
      /**
       * APPRENDRE DE CE QUE TIMÉO CORRIGE — et pas seulement de ce qu'il valide.
       *
       * ⚠️ L'apprentissage existait mais perdait l'essentiel. Quand Timéo modifiait un brouillon,
       * `reply_drafts.body` était ÉCRASÉ par sa version : on savait qu'il avait corrigé (`edited`),
       * jamais CE QU'IL AVAIT CORRIGÉ. L'agent recevait de bons exemples, jamais l'écart entre ce
       * qu'il avait proposé et ce qu'un humain a jugé bon. Or c'est l'écart qui enseigne.
       *
       * Et un REJET n'apprenait rien du tout, alors que c'est le signal le plus net qui soit :
       * « ne réponds jamais comme ça ».
       *
       * On conserve donc la proposition d'origine (`body_ia`), et `learned_replies` distingue
       * l'exemple à suivre de l'exemple à fuir.
       */
      nom: 'apprentissage : garder la version IA et les rejets',
      run: () => db.execute(sql`
        ALTER TABLE reply_drafts   ADD COLUMN IF NOT EXISTS body_ia TEXT;
        ALTER TABLE learned_replies
          ADD COLUMN IF NOT EXISTS answer_ia TEXT,
          ADD COLUMN IF NOT EXISTS rejete    BOOLEAN NOT NULL DEFAULT FALSE
      `),
    },
    {
      nom: 'rdv : classement client (crm_stage) + motif de non-qualification',
      run: () => db.execute(sql`
        ALTER TABLE rdv
          ADD COLUMN IF NOT EXISTS crm_stage          TEXT DEFAULT 'a_venir',
          ADD COLUMN IF NOT EXISTS unqualified_reason TEXT
      `),
    },
    {
      nom: 'reply_drafts : qui a rejete le brouillon',
      run: () => db.execute(sql`
        ALTER TABLE reply_drafts
          ADD COLUMN IF NOT EXISTS rejete_par  TEXT,
          ADD COLUMN IF NOT EXISTS rejete_le   TIMESTAMPTZ
      `),
    },
    {
      nom: 'scrape_couverture : metier x ville deja achetes',
      run: () => db.execute(sql`
        CREATE TABLE IF NOT EXISTS scrape_couverture (
          id          SERIAL PRIMARY KEY,
          categorie   TEXT NOT NULL,
          ville       TEXT NOT NULL,
          fiches      INTEGER NOT NULL DEFAULT 0,
          importe_le  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (categorie, ville)
        )
      `),
    },
    {
      nom: 'outscraper_leads: category + sector',
      run: () => db.execute(sql`
        ALTER TABLE outscraper_leads
          ADD COLUMN IF NOT EXISTS category TEXT,
          ADD COLUMN IF NOT EXISTS sector   TEXT
      `),
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
