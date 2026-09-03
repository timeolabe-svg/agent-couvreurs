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
      /**
       * COMMISSION RÉCURRENTE — 5 % du montant MENSUEL, tant que le client reste client.
       *
       * ⚠️ MODÈLE CORRIGÉ LE 17/08. La première version stockait un CA ponctuel : le client signe,
       * on prend 5 % une fois. Faux. Haris facture ses clients au mois, donc la commission court
       * tant que le client reste — deux clients à 500 €/mois font 50 €/mois pour Timéo, chaque mois.
       *
       * ⚠️ ET SURTOUT : ON N'EFFACE JAMAIS UN CLIENT PERDU, on lui pose une DATE DE FIN.
       * Supprimer la ligne ferait changer les factures des mois déjà prélevés — un client parti en
       * novembre modifierait rétroactivement ce qui a été facturé en septembre. Une facture émise
       * ne se réécrit pas : c'est ce qui permet aux deux parties de se mettre d'accord des mois
       * plus tard. `client_actif_jusqu_a` NULL = toujours client.
       */
      nom: 'rdv : abonnement client (montant mensuel + date de fin)',
      run: () => db.execute(sql`
        ALTER TABLE rdv
          ADD COLUMN IF NOT EXISTS montant_mensuel        NUMERIC(12,2),
          ADD COLUMN IF NOT EXISTS client_actif_jusqu_a   DATE
      `),
    },
    {
      // ⚠️ UNE SEULE INSTRUCTION PAR APPEL. Le driver Neon refuse deux ALTER separes par un
      // point-virgule dans le meme execute — la migration echouait en bloc, et l apprentissage
      // n avait donc AUCUNE de ses colonnes. Une migration qui echoue a moitie est pire qu une
      // migration absente : le code croit les colonnes presentes.
      nom: 'apprentissage : garder la version IA (reply_drafts)',
      run: () => db.execute(sql`ALTER TABLE reply_drafts ADD COLUMN IF NOT EXISTS body_ia TEXT`),
    },
    {
      nom: 'apprentissage : version IA + rejets (learned_replies)',
      run: () => db.execute(sql`
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
      /**
       * ABSENCE / FERMETURE — la date de RETOUR doit être STOCKÉE, pas seulement utilisée.
       *
       * Le poller savait déjà lire « nous reprenons le 25 août » et décalait les relances en
       * conséquence. Mais la date n'était écrite nulle part : impossible de la voir, de la vérifier,
       * de trier ces prospects, et surtout impossible de savoir QUI revient QUAND. Timéo les
       * cherchait dans la messagerie — ils n'y étaient nulle part, l'écran masque les absences.
       *
       * On garde donc la date sur la fiche : elle devient un onglet, une liste, et une relance à date.
       */
      nom: 'contacts : absence (date de retour + motif)',
      run: () => db.execute(sql`
        ALTER TABLE contacts
          ADD COLUMN IF NOT EXISTS absent_jusqu_au   DATE,
          ADD COLUMN IF NOT EXISTS absence_motif     TEXT,
          ADD COLUMN IF NOT EXISTS absence_vue_le    TIMESTAMPTZ
      `),
    },
    {
      /**
       * ⚠️ LE RENVOI VERS UNE NOUVELLE ADRESSE DOIT ÊTRE UNE DONNÉE, PAS UN TEXTE À RE-DEVINER.
       *
       * Le prospect écrit « merci de prendre en compte la nouvelle adresse de correspondance ». Le
       * traitement a parfaitement fonctionné : contact créé sur la nouvelle adresse, ancienne file
       * annulée. Mais l'AFFICHAGE re-cherchait l'intention dans le texte avec sa propre expression,
       * qui exigeait « nouvelle adresse MAIL » — « de correspondance » n'y figurait pas. L'ancienne
       * conversation restait donc dans « En attente », comme un lead à traiter alors qu'il était
       * déjà repris ailleurs.
       *
       * Deux règles de détection pour un même fait finissent toujours par diverger. On écrit le
       * fait une fois, au moment où il se produit.
       */
      nom: 'contacts : adresse de renvoi (changement d adresse)',
      run: () => db.execute(sql`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS redirige_vers TEXT`),
    },
    {
      /**
       * PLAN DE COUVERTURE NATIONALE — quelle commune reste à ratisser, pour quel métier.
       *
       * ⚠️ Sans mémoire écrite, un achat automatique repasse sur les mêmes villes et RE-PAIE des
       * fiches qu'on possède déjà : l'import les jette en doublon, l'argent est parti quand même.
       * La table dit, pour chaque couple (métier, commune), s'il est fait, ce qu'il a rapporté et
       * ce qu'il a coûté — c'est elle qui garantit qu'on avance au lieu de tourner en rond.
       *
       * On stocke la population : elle sert à trier (les zones denses d'abord) et à savoir quand
       * s'arrêter. Un village de 300 habitants est de toute façon couvert par la recherche sur la
       * ville voisine — y aller quand même, c'est payer deux fois les mêmes entreprises.
       */
      nom: 'villes_scraping : plan de couverture national',
      run: () => db.execute(sql`
        CREATE TABLE IF NOT EXISTS villes_scraping (
          code_insee   TEXT PRIMARY KEY,
          nom          TEXT NOT NULL,
          departement  TEXT,
          population   INTEGER,
          creee_le     TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `),
    },
    {
      nom: 'villes_scraping : index population',
      run: () => db.execute(sql`CREATE INDEX IF NOT EXISTS villes_scraping_pop_idx ON villes_scraping(population DESC)`),
    },
    {
      /**
       * ⚠️ COLONNES AJOUTÉES À LA COUVERTURE EXISTANTE plutôt qu'une table neuve : 463 couples
       * (métier, ville) y sont déjà enregistrés depuis les achats manuels. Repartir de zéro
       * ferait racheter tout ce qui a déjà été payé.
       *
       * `statut` distingue « fait » (rapporté des fiches) de « epuise » (0 fiche : la ville n'a
       * plus rien à donner pour ce métier) — un couple épuisé ne se retente pas avant longtemps.
       * `cout_usd` permet de dire ce que l'automatisation a réellement dépensé, sans l'estimer.
       */
      nom: 'scrape_couverture : statut, cout et trace de la commande',
      run: () => db.execute(sql`
        ALTER TABLE scrape_couverture
          ADD COLUMN IF NOT EXISTS statut        TEXT NOT NULL DEFAULT 'fait',
          ADD COLUMN IF NOT EXISTS code_insee    TEXT,
          ADD COLUMN IF NOT EXISTS cout_usd      NUMERIC(10,4),
          ADD COLUMN IF NOT EXISTS commande_id   TEXT,
          ADD COLUMN IF NOT EXISTS nouveaux      INTEGER,
          ADD COLUMN IF NOT EXISTS doublons      INTEGER
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
    /**
     * ⚠️ `blocklist` N'AVAIT AUCUNE CONTRAINTE UNIQUE SUR `email` (26/08, audit A→Z).
     *
     * Deux `INSERT … ON CONFLICT (email) DO NOTHING` visaient cette colonne. Or `ON CONFLICT` n'est
     * pas tolérant : **sans contrainte unique sur la colonne visée, Postgres LÈVE une erreur** au
     * lieu d'ignorer le doublon. Les deux insertions échouaient donc systématiquement — et elles
     * sont dans `stop-non-respectes`, c'est-à-dire dans le filet CNIL.
     *
     * ⚠️ Le plus instructif : j'avais « corrigé » ce filet une heure plus tôt en retirant deux
     * colonnes fantômes. Le vrai défaut était double, et je n'en avais vu qu'une moitié. Une cause
     * corrigée ne prouve pas un chemin réparé — il faut le faire tourner et regarder le résultat.
     *
     * On déduplique AVANT de créer l'index (une contrainte unique échoue s'il existe des doublons),
     * en gardant la plus ANCIENNE entrée : c'est elle qui porte la vraie date du refus, et un refus
     * se date.
     */
    {
      nom: 'blocklist : dédoublonnage par email avant contrainte unique',
      run: () => db.execute(sql`
        DELETE FROM blocklist a USING blocklist b
        WHERE a.email IS NOT NULL AND b.email IS NOT NULL
          AND LOWER(a.email) = LOWER(b.email)
          AND (a.created_at > b.created_at OR (a.created_at = b.created_at AND a.id > b.id))
      `),
    },
    {
      nom: 'blocklist : contrainte unique sur email (sans elle, ON CONFLICT lève une erreur)',
      run: () => db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS blocklist_email_uq ON blocklist(email)`),
    },

    // ─── 03/09/2026 — CANAL LINKEDIN (Hdigiweb, accord de Haris) ───────────────────────────
    //
    // Un dirigeant trouvé via SIRENE peut n'avoir aucun email exploitable. `contacts.email`
    // était NOT NULL : impossible d'entrer ces prospects dans le référentiel unique. Audit
    // préalable fait sur les 12 fichiers touchant contacts.email dans app/api/cron avant de
    // retirer la contrainte — aucun ne lit .email sans garde sur un contact qui pourrait être
    // LinkedIn-only (voir lib/db/schema.ts).
    {
      nom: 'contacts : email devient optionnel (canal LinkedIn)',
      run: () => db.execute(sql`ALTER TABLE contacts ALTER COLUMN email DROP NOT NULL`),
    },
    {
      nom: 'contacts : add linkedin_url',
      run: () => db.execute(sql`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS linkedin_url TEXT`),
    },
    {
      nom: 'contacts : contrainte unique sur linkedin_url',
      run: () => db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS contacts_linkedin_url_uq ON contacts(linkedin_url) WHERE linkedin_url IS NOT NULL`),
    },
    {
      // ⚠️ Le driver Neon (HTTP) n'exécute qu'UNE instruction par appel — deux ALTER séparés par
      // un point-virgule dans le même sql`` échouaient silencieusement en un seul ERR groupé.
      // Toujours une instruction par entrée de migration, comme partout ailleurs dans ce fichier.
      nom: 'contacts : retirer l ancienne contrainte email/linkedin (si présente)',
      run: () => db.execute(sql`ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_email_or_linkedin_chk`),
    },
    {
      // Un contact sans AUCUN moyen de contact n'a pas sa place en base — ni email ni LinkedIn
      // n'est un état valide, contrairement à "l'un des deux manque".
      nom: 'contacts : contrainte email OU linkedin_url renseigné',
      run: () => db.execute(sql`
        ALTER TABLE contacts ADD CONSTRAINT contacts_email_or_linkedin_chk
          CHECK (email IS NOT NULL OR linkedin_url IS NOT NULL)
      `),
    },
    {
      // `linkedin_leads` existait déjà dans le schéma mais n'était branchée nulle part (aucune
      // route, aucun cron, aucune UI) — un embryon mort. `contact_id` est le pont qui la fait
      // enfin entrer dans le référentiel unique, la messagerie et les invariants partagés.
      nom: 'linkedin_leads : réparation (contact_id + cycle de statut complet)',
      run: () => db.execute(sql`
        ALTER TABLE linkedin_leads
          ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES contacts(id),
          ADD COLUMN IF NOT EXISTS invited_at TIMESTAMP,
          ADD COLUMN IF NOT EXISTS connected_at TIMESTAMP,
          ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMP
      `),
    },
    {
      nom: 'linkedin_leads : index sur contact_id',
      run: () => db.execute(sql`CREATE INDEX IF NOT EXISTS ll_contact_idx ON linkedin_leads(contact_id)`),
    },
    {
      nom: 'linkedin_leads : index sur status',
      run: () => db.execute(sql`CREATE INDEX IF NOT EXISTS ll_status_idx ON linkedin_leads(status)`),
    },
    {
      // Anti-doublon d'invitation : deux lignes ne peuvent viser le même profil.
      nom: 'linkedin_leads : contrainte unique sur profile_url',
      run: () => db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS ll_profile_url_uq ON linkedin_leads(profile_url) WHERE profile_url IS NOT NULL`),
    },
    {
      // Point de jonction unique entre les deux canaux (principe éprouvé chez LabegarIA) : c'est
      // channel qui alimente le badge de la messagerie et le filtre des statistiques.
      nom: 'incoming_replies : add channel + linkedin_lead_id',
      run: () => db.execute(sql`
        ALTER TABLE incoming_replies
          ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'email',
          ADD COLUMN IF NOT EXISTS linkedin_lead_id UUID REFERENCES linkedin_leads(id)
      `),
    },
    {
      // Un message LinkedIn n'a pas d'adresse email.
      nom: 'incoming_replies : from_email devient optionnel (canal LinkedIn)',
      run: () => db.execute(sql`ALTER TABLE incoming_replies ALTER COLUMN from_email DROP NOT NULL`),
    },
    {
      nom: 'blocklist : add linkedin_url + source',
      run: () => db.execute(sql`
        ALTER TABLE blocklist
          ADD COLUMN IF NOT EXISTS linkedin_url TEXT,
          ADD COLUMN IF NOT EXISTS source TEXT
      `),
    },
    {
      // Le budget réel des visites/jour vit dans state.json, LOCAL au VPS du bot, fail-closed si
      // illisible — cette table n'est qu'un REPORTING poussé par le bot à chaque cycle, jamais la
      // source de vérité du garde-fou (le bot ne doit jamais dépendre du réseau pour connaître
      // son propre budget).
      nom: 'linkedin_bot_state : create table',
      run: () => db.execute(sql`
        CREATE TABLE IF NOT EXISTS linkedin_bot_state (
          id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          client                    TEXT NOT NULL DEFAULT 'hdigiweb',
          daily_profile_visits      INTEGER DEFAULT 0,
          daily_profile_visits_date DATE,
          daily_invites_sent        INTEGER DEFAULT 0,
          daily_invites_date        DATE,
          ramp_start                TIMESTAMP,
          last_heartbeat_at         TIMESTAMP,
          updated_at                TIMESTAMP DEFAULT now()
        )
      `),
    },
    {
      nom: 'linkedin_bot_state : contrainte unique sur client',
      run: () => db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS lbs_client_uq ON linkedin_bot_state(client)`),
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
