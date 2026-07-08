# 📘 PLAYBOOK — Agent IA de prospection cold email (blueprint réutilisable)

> Ce document décrit **de A à Z** comment est construit l'agent (projet `agent-couvreurs` / Hdigiweb),
> pour pouvoir le **répliquer sur d'autres clients sans refaire les mêmes erreurs**.
> Il contient : la stack, l'architecture, tous les services à connecter, toutes les variables
> d'environnement, la base de données, tous les crons, chaque fonctionnalité, le système
> d'auto-apprentissage, ET surtout **la liste des pièges rencontrés + comment les éviter**.
>
> ⚠️ La section 11 (ERREURS À NE PAS REFAIRE) est la plus importante. Lis-la en premier avant chaque nouveau projet.

---

## ⚠️ MISE À JOUR MAJEURE — 2026-07-08 (fait autorité sur les sections "envoi/réponses" ci-dessous)

Le projet a migré de **Instantly (envoi)** vers un **moteur d'envoi + réponses MAISON** (SMTP/IMAP Gmail). Raison : Instantly plafonne à **1000 contacts uploadés** (limite dure, partagée entre projets, vite saturée). Le moteur maison n'a **aucune limite de leads**. **Instantly ne sert plus qu'au WARMUP.**

**Nouvelle architecture d'envoi :**
- `lib/gmail-sender.ts` : envoi SMTP (`smtp.gmail.com:465`) depuis les boîtes de la variable `IMAP_ACCOUNTS` (JSON `[{"email","password":"mdp app 16c","name"}]`).
- `autopilot-tick` : ne pousse **plus** vers Instantly → génère la séquence (4 mails) et insère **4 lignes `email_queue`** (J+0/J+3/J+7/J+14, statut `queued`).
- `send-campaign` (**NOUVEAU cron**) : draine `email_queue` via SMTP, **≤40/boîte/jour** (35 côté client hdigiweb).
- `poll-imap-replies` (**NOUVEAU cron**) : lit les boîtes en **IMAP**, classe, capture changement d'adresse, cale les RDV, blocklist, et envoie les auto-réponses via SMTP (`lib/reply-agent/send-reply.ts`). **Remplace `check-replies` (supprimé)**. `backfill-sequences` supprimé aussi.

**🛑 6 PROTECTIONS ANTI-BOUCLE OBLIGATOIRES** (après un incident réel : 130 mails au même contact + "Stop" ignoré) — dans tout `send-campaign` maison :
1. Kill-switch `SEND_PAUSED=1` (env).
2. **Claim atomique** : `UPDATE email_queue SET status='sending' WHERE id IN (SELECT ... 'queued' ... LIMIT n)` → une ligne réclamée n'est plus re-sélectionnable (zéro renvoi concurrent/après-timeout).
3. **Reaper** : `status='sending' AND sent_at < NOW()-15min` → requeue (récupère les crashs).
4. Échec d'envoi → `'failed'`, **jamais** de retour en `'queued'`.
5. **Anti-doublon** : `NOT EXISTS (email_queue s WHERE s.contact_id=eq.contact_id AND s.sequence_step=eq.sequence_step AND s.status='sent')` → jamais 2× le même (contact, étape). Neutralise RÉTROACTIVEMENT une pile de doublons déjà en base.
6. **Plafond à vie** : `COUNT(sent par contact) < 4`.
+ Opt-out dans le claim : exclure `incoming_replies` (hors oof/spam) ET `blocklist` (email + domaine). Côté mise en file : `ON CONFLICT DO NOTHING` (jamais `DO UPDATE status='queued'`, qui écraserait un opt-out) et ne queue QUE les contacts neufs.

**🛑 4 FREINS COÛT GOOGLE PLACES OBLIGATOIRES** (l'API Places est **payante** ~0,03-0,04€/appel ; un scraping non bridé a coûté 119€) — dans tout cron de scraping :
1. Kill-switch `SCRAPING_PAUSED=1`.
2. **Ne scraper QUE si réserve < ~100 leads** (le vrai levier).
3. **Plafond dur ~30 appels/jour** (compteur `places_calls_today` en `agent_config`).
4. Throttle 1 scrape / 30 min (`last_scrape_at`).
+ Côté Google Cloud (seul plafond vraiment dur) : **APIs → Places API → Quotas → "Requests per day" (ou "SearchTextRequest per day") bas** + alerte de budget. NB : Places API **classique** (`maps/api/place/textsearch`) et **New** (`places:searchText`) ont des lignes de quota DIFFÉRENTES — vérifier laquelle le code utilise.

**Nouvelles variables d'env :** `IMAP_ACCOUNTS` (obligatoire pour envoyer), `SEND_PAUSED`, `SCRAPING_PAUSED` (kill-switches). `INSTANTLY_INBOXES`/`INSTANTLY_INBOX_NAMES` restent (servent au nom d'expéditeur / signature).
**Nouveaux crons cron-job.org :** `send-campaign` + `poll-imap-replies` (5-10 min). **Supprimer** l'ancien cron `check-replies`.

---

## 0. Ce que fait l'agent (résumé)

Un agent **100% autonome** qui, tout seul, en boucle :
1. **Scrape** des prospects (entreprises locales) via Google Maps
2. **Audite** leur site web (détecte les vrais défauts techniques/SEO)
3. **Valide** leurs emails (délivrabilité)
4. **Écrit** un cold email ultra-personnalisé qui attaque le vrai défaut du site
5. **Envoie** via ses propres boîtes Google chauffées (moteur SMTP maison — voir la MISE À JOUR 2026-07-08 ci-dessus ; Instantly = warmup only) — 4 emails de séquence : initial + 3 relances
6. **Gère les réponses** (classe, répond automatiquement, gère les objections)
7. **Cale les RDV** dans Google Calendar + facture via Stripe
8. **S'améliore chaque mois** (teste des variantes/segments, garde les gagnants)

Objectif business : générer des RDV qualifiés en continu, sans intervention humaine.

---

## 1. Stack technique (et pourquoi)

| Brique | Techno | Rôle |
|--------|--------|------|
| Framework | **Next.js 16** (App Router) | API routes + dashboard, hébergé serverless |
| Langage | **TypeScript** | Tout le code |
| Base de données | **Neon** (Postgres serverless) | Mémoire partagée entre tous les crons |
| ORM | **Drizzle** | Requêtes SQL typées (`lib/db/schema.ts`) |
| Hébergement | **Vercel** (plan Hobby) | Déploiement + exécution serverless |
| Déclencheurs (crons) | **cron-job.org** (externe) | Lance les crons (Vercel Hobby ne fait que du daily) |
| Envoi d'emails | **Instantly** (API v2) | Boîtes d'envoi + warm-up + séquences |
| IA | **Google Gemini** (`gemini-2.5-flash`) | Génération d'emails + classification + réponses |
| Scraping | **Google Places API** | Trouve les entreprises + leurs infos |
| Validation email | **MillionVerifier** | Vérifie qu'une adresse existe (anti-bounce) |
| Notifications | **Resend** | Emails de rapport au client (RDV calé, rapport hebdo) |
| Agenda | **Google Calendar API** (OAuth) | Crée les évènements RDV + Google Meet |
| Facturation | **Stripe** | Facture automatiquement chaque RDV calé |
| Auth dashboard | **NextAuth** (Credentials) | Protège le dashboard |

> Note : `@anthropic-ai/sdk` est dans les deps mais on utilise Gemini (moins cher). Le wrapper IA est dans `lib/ai.ts`.

---

## 2. Architecture globale — le pipeline DÉCOUPLÉ

**LA leçon la plus importante** : ne PAS tout faire dans un seul cron. Chaque étape lourde = son propre cron, léger, qui lit/écrit dans la base. Sinon → timeouts.

```
cron-job.org (déclencheurs planifiés)
        │
        ▼
[scrape-leads]  → insère les contacts (audit_done=false, email_validated=false) + email_queue(pending)
        │  (écrit en base)
        ▼
[audit-sites]   → audite le site de chaque contact → audit_done=true + défauts stockés
        │
        ▼
[validate-emails] → MillionVerifier sur les emails incertains → email_validated=true / file annulée
        │
        ▼
[autopilot-tick] → n'ENVOIE QUE les contacts audités + (email sûr OU validé). Tire une variante,
        │            génère 4 emails perso, pousse à Instantly, marque variant_id.
        ▼
[check-replies] → récupère les réponses Instantly, classe, répond auto, cale les RDV, facture
        │
        ▼
[self-improve]  → 1×/mois : mesure réponses+RDV par variante/secteur/région, réécrit les poids
```

La **base Neon** = le lien entre toutes les étapes (comme les connexions entre nodes N8N).

---

## 3. Les services externes à connecter (étape par étape)

### 3.1 Neon (base de données)
1. Créer un projet sur neon.tech → une base `neondb`.
2. Copier la **connection string** → `DATABASE_URL`.
3. Créer les tables : soit `npm run db:push` (drizzle-kit) en local avec `DATABASE_URL` set, soit exécuter le SQL à la main (voir section 5).

### 3.2 Vercel (hébergement)
1. Importer le repo GitHub dans Vercel.
2. Mettre TOUTES les variables d'env (section 4) dans **Settings → Environment Variables** (Production).
3. **⚠️ VÉRIFIER que l'auto-déploiement GitHub→Vercel fonctionne** (voir erreur #4). Sinon déployer via CLI : `npx vercel --prod`.
4. L'URL stable de prod = `https://<projet>.vercel.app` (le domaine principal). **Toujours utiliser celle-là**, jamais les URLs avec un hash (`<projet>-xxxxx.vercel.app` = déploiements figés).

### 3.3 Instantly (envoi d'emails) — LE PLUS DÉLICAT
1. Créer un compte Instantly, connecter les **boîtes d'envoi** (ex : 4 adresses `gabin@domaine1.com`...). Activer le **warm-up** sur chacune (2-3 semaines avant d'envoyer en volume).
2. Créer une **Campagne**. Dans **Sequences**, créer **4 étapes (steps)** avec EXACTEMENT ces variables :
   - Step 1 → Objet : `{{subject}}`  · Corps : `{{body}}`
   - Step 2 → Objet : `{{subject2}}` · Corps : `{{body2}}`
   - Step 3 → Objet : `{{subject3}}` · Corps : `{{body3}}`
   - Step 4 → Objet : `{{subject4}}` · Corps : `{{body4}}`
   > ⚠️ Si le template ne contient pas ces variables, **TOUS les mails partent VIDES** (erreur #1).
3. Régler les délais entre steps (ex : 3, 7, 14 jours) et la **limite quotidienne** par boîte.
4. Récupérer l'**API key** (Settings) → `INSTANTLY_API_KEY`.
5. Récupérer l'**ID de la campagne** (dans l'URL de la campagne) → `INSTANTLY_CAMPAIGN_ID` (et/ou le mettre dans `campaigns.instantly_campaign_id` en base).
6. Lister les boîtes dans `INSTANTLY_INBOXES` (emails séparés par virgule) + `INSTANTLY_INBOX_NAMES` (prénoms des expéditeurs, même ordre).

### 3.4 cron-job.org (déclencheurs)
Pour CHAQUE cron (section 6), créer une tâche :
- **URL** : `https://<projet>.vercel.app/api/cron/<nom>`
- **Méthode** : GET
- **Header** : `Authorization: Bearer <CRON_SECRET>` (le suffixe cache-buster `%cjo:uuid4%%cjo:unixtime%` est toléré, voir erreur #3)
- **Fréquence** : voir section 6

### 3.5 Google Places API (scraping)
1. Google Cloud Console → activer **Places API** → créer une clé → `GOOGLE_PLACES_API_KEY`.
2. Activer la facturation (quota gratuit généreux, mais CB requise).

### 3.6 MillionVerifier (validation email) — payant
1. Compte MillionVerifier, acheter des crédits, récupérer l'API key → `MILLION_VERIFIER_API_KEY`.
2. Sans cette clé : seuls les emails "sûrs" (cliquables) partent, le reste attend en stock (voir section 8.3).

### 3.7 Gemini (IA)
1. Google AI Studio → créer une clé → `GEMINI_API_KEY`. Modèle par défaut `gemini-2.5-flash` (`GEMINI_MODEL`).

### 3.8 Resend (notifications)
1. Compte Resend, vérifier un domaine d'envoi (DNS), récupérer l'API key → `RESEND_API_KEY`, `RESEND_FROM_EMAIL` (adresse du domaine vérifié).
2. `CLIENT_NOTIFY_EMAIL` = où envoyer les rapports (peut contenir plusieurs adresses séparées par virgule).

### 3.9 Google Calendar (RDV) — OAuth
1. Google Cloud → OAuth consent + créer un OAuth Client → `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
2. Obtenir un **refresh token** (flow OAuth une fois) → `GOOGLE_REFRESH_TOKEN`.
3. Sans ces vars : les RDV ne sont pas créés (mock) et **ne sont pas facturés** (garde-fou, erreur #6).

### 3.10 Stripe (facturation RDV)
1. Clé secrète → `STRIPE_SECRET_KEY`. Webhook secret → `STRIPE_WEBHOOK_SECRET`.
2. Le client enregistre sa CB via `/api/stripe/setup`. Ensuite chaque vrai RDV = facturé (50€ par défaut, idempotent).

### 3.11 NextAuth (auth dashboard)
1. `NEXTAUTH_SECRET` (random), `NEXT_PUBLIC_BASE_URL` (= URL du site).
2. Identifiants : `AUTH_USER1_EMAIL`/`AUTH_USER1_PASSWORD` (+ USER2). ⚠️ En clair pour l'instant (à hasher idéalement).

---

## 4. Variables d'environnement (liste COMPLÈTE)

| Variable | Service | Rôle |
|----------|---------|------|
| `DATABASE_URL` | Neon | Connexion Postgres |
| `CRON_SECRET` | interne | Protège tous les crons (Bearer token) |
| `INSTANTLY_API_KEY` | Instantly | API d'envoi |
| `INSTANTLY_CAMPAIGN_ID` | Instantly | Campagne cible (fallback si pas en base) |
| `INSTANTLY_INBOXES` | Instantly | Boîtes d'envoi (emails, séparés par virgule) |
| `INSTANTLY_INBOX_NAMES` | Instantly | Prénoms expéditeurs (même ordre) |
| `GOOGLE_PLACES_API_KEY` | Google | Scraping Places |
| `MILLION_VERIFIER_API_KEY` | MillionVerifier | Validation email (optionnel) |
| `GEMINI_API_KEY` | Gemini | IA |
| `GEMINI_MODEL` | Gemini | Modèle (défaut `gemini-2.5-flash`) |
| `RESEND_API_KEY` | Resend | Notifications |
| `RESEND_FROM_EMAIL` | Resend | Expéditeur des notifs (domaine vérifié) |
| `CLIENT_NOTIFY_EMAIL` | interne | Destinataire des rapports |
| `GOOGLE_CLIENT_ID` | Google Calendar | OAuth |
| `GOOGLE_CLIENT_SECRET` | Google Calendar | OAuth |
| `GOOGLE_REFRESH_TOKEN` | Google Calendar | OAuth (accès agenda) |
| `STRIPE_SECRET_KEY` | Stripe | Facturation |
| `STRIPE_WEBHOOK_SECRET` | Stripe | Webhook |
| `NEXTAUTH_SECRET` | NextAuth | Chiffrement session |
| `NEXT_PUBLIC_BASE_URL` | interne | URL publique du site |
| `AUTH_USER1_EMAIL` / `AUTH_USER1_PASSWORD` | NextAuth | Login dashboard (admin) |
| `AUTH_USER2_EMAIL` / `AUTH_USER2_PASSWORD` | NextAuth | Login dashboard (client) |
| `AUTOPILOT_SCRAPING` | interne | Mettre `true` pour réactiver le scraping DANS autopilot (secours). Défaut off. |
| `ADMIN_API_KEY` | interne | Auth alternative du endpoint de scrape manuel (`/api/leads/scrape`) |
| `NEXT_PUBLIC_SCRAPE_TOKEN` | interne | Token navigateur pour déclencher un scrape manuel depuis le dashboard |
| `NODE_ENV` | standard | Géré par Vercel (production/development) |

> ⚠️ Sur Vercel, ces variables sont "Sensitive" (chiffrées) : impossible de les relire après enregistrement. Note-les ailleurs. Pour les récupérer si oubliées : voir cron-job.org (le `CRON_SECRET` est dans le header des tâches).

---

## 5. Base de données (13 tables)

Fichier source : `lib/db/schema.ts`. Générer avec `npm run db:push`, ou SQL manuel.

| Table | Rôle |
|-------|------|
| `contacts` | Les prospects (email, secteur, ville, note Google, **audit_*, email_validated, email_confidence_score, audit_done**) |
| `campaigns` | Campagnes (status active/paused, **instantly_campaign_id**) |
| `email_queue` | File des emails (status pending/sent/cancelled, **variant_id**, sequence_step) |
| `incoming_replies` | Réponses reçues (classification, action_taken, **instantly_reply_id UNIQUE**) |
| `reply_drafts` | Brouillons de réponse (status pending/scheduled/sent, send_after = délai humain) |
| `rdv` | Rendez-vous (scheduled_at, status, google_event_id, google_meet_link) |
| `blocklist` | Opt-outs (email, reason unsubscribe/bounce/desinterest/manual) |
| `learning_reports` | Rapports d'auto-apprentissage (reply_rate, recommendations JSON) |
| `learned_replies` | Réponses validées par l'humain → réutilisées par l'agent |
| `agent_config` | **Config dynamique clé/valeur** (poids d'apprentissage, prompt_addon, index de scraping...) |
| `linkedin_leads` | (canal LinkedIn — non actif dans ce projet) |
| `phone_leads` | (canal téléphone — non actif) |
| `dashboard_events` | Flux d'évènements temps réel (SSE dashboard) |

### Migrations SQL manuelles à appliquer (au-delà du schéma de base)
Ces `ALTER` sont idempotents. À lancer dans Neon SQL Editor pour un projet existant :
```sql
-- Colonnes audit (si absentes)
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS audit_score integer;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS audit_level text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS audit_weaknesses text[];
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS audit_cms text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS audit_done boolean DEFAULT false;
-- Variante testée (auto-apprentissage)
ALTER TABLE email_queue ADD COLUMN IF NOT EXISTS variant_id text;
-- Dédup permanente des réponses (anti crons concurrents)
CREATE UNIQUE INDEX IF NOT EXISTS ir_instantly_reply_id_uq ON incoming_replies (instantly_reply_id);
-- Normalisation opt-out RGPD (une fois)
UPDATE blocklist SET email = lower(email) WHERE email <> lower(email);
UPDATE contacts  SET email = lower(email) WHERE email <> lower(email);
```
> ⚠️ **Appliquer la migration AVANT de déployer** le code qui utilise la colonne/contrainte (erreur #7), sinon crash runtime / doublons.

---

## 6. Les crons (déclenchés par cron-job.org)

| Cron (URL `/api/cron/…`) | Fréquence | Rôle |
|--------------------------|-----------|------|
| `scrape-leads` | **10 min** | Scrape secteur+région pondérés → insère contacts + file |
| `audit-sites` | **5 min** | Audite les sites non audités (batch 8) |
| `validate-emails` | **5 min** (seulement si MillionVerifier payé) | Valide les emails incertains |
| `autopilot-tick` | **~1h** (ton réglage) | Envoi seul (contacts audités + sûrs) |
| `check-replies` | **30 min** | Traite réponses, répond auto, cale RDV, facture |
| `self-improve` | **mensuel** (`0 6 1 * *`) | Auto-apprentissage : réécrit les poids |

Crons secondaires présents mais optionnels : `morning-digest` (rapport matinal), `weekly-learning` (**remplacé par self-improve — ne PAS l'activer**), `backfill-sequences` (obsolète, cassé), `strategy-agent`, `debug-hot-leads`, `manual-relay`.

Tous les crons vérifient l'auth via `lib/cron-auth.ts` (`checkCronAuth`) → tolérant au cache-buster de cron-job.org.

---

## 7. Le pipeline détaillé (fichier par fichier)

### 7.1 Scraping — `lib/scraper/google-places.ts` + `app/api/cron/scrape-leads/route.ts`
- Choisit un **secteur + région pondérés** (`lib/experiments.ts` + `lib/scrape-targets.ts`).
- `scrapeGooglePlaces()` : Text Search Google → Place Details → scrape l'email sur le site.
- **Score de confiance email** (`scrapeEmailFromWebsite`) :
  - 95 = `mailto:` cliquable sur leur domaine · 90 = `mailto:` autre domaine
  - 75 = préfixe pro (`contact@`, `info@`...) trouvé sur leur domaine
  - 60 = préfixe pro hors domaine · 55/40 = deviné (peu fiable)
- Insère le contact (`audit_done=false`, `email_validated=false`) + `email_queue(pending)` si confiance ≥ 70.
- Filtres : blocklist, `isFakeEmail()` (`lib/fake-email.ts`), doublons (`google_place_id`/`email` unique).

### 7.2 Audit de site — `lib/website-audit.ts` + `app/api/cron/audit-sites/route.ts`
- `auditWebsite()` : fetch la homepage + check HTTPS → détecte : pas de viewport (mobile), pas de HTTPS, CMS obsolète, jQuery ancien, Flash, pas de H1/meta description/Schema.org, contenu Lorem ipsum, copyright ancien, site abandonné.
- Renvoie `{ score, level (no-website/abandoned/very-outdated/outdated/modern), weaknesses[], cms }`.
- Stocke sur le contact + `audit_done=true`.
- Garde-fous : timeout par site, budget total, marque audité même en cas d'échec (pas de boucle infinie).

### 7.3 Validation email — `app/api/cron/validate-emails/route.ts`
- MillionVerifier sur les contacts `email_validated=false` ayant une file pending.
- `ok` → `email_validated=true`. `invalid/catch_all/disposable` → file annulée. `unknown` → re-tenté.
- Sans clé MV → ne fait rien (les incertains restent en stock).

### 7.4 Génération d'email — `lib/email-generator.ts`
- `generateSequence(lead, fromEmail, fromName, variantInstruction)` : 1 appel Gemini → 4 emails.
- Le prompt (SYSTEM_PROMPT) impose un style **court (50-90 mots), simple, artisan**, qui ouvre sur le **défaut audité** (`buildAuditContext`) et intègre l'offre "premier mois offert" en relance 2.
- **Garantit 4 emails NON VIDES** : filtre les bodies vides, comble les trous par un template (`data/sequence.ts`), refuse d'envoyer si l'initial est vide (erreur #1).
- La signature `Thomas Renard` / `thomas@hdigiweb.fr` est remplacée par l'inbox réelle.

### 7.5 Envoi — `app/api/cron/autopilot-tick/route.ts` + `lib/instantly/client.ts`
- **Ramp** : monte le volume progressivement (`RAMP_SCHEDULE`, cible 35/boîte/jour).
- **Garde-fous d'envoi** (le `where` de la file) : `audit_done=true` ET (`email_confidence_score >= 90` OU `email_validated=true`). → jamais de bounce, jamais de mail générique.
- Tire une **variante d'angle pondérée**, génère la séquence, pousse le lead à Instantly avec `custom_variables` (`subject`/`body`/`subject2`/`body2`...), marque `variant_id`.
- **Rotation des boîtes** atomique (`lib/instantly/inbox-rotation.ts`).

### 7.6 Réponses & RDV — `app/api/cron/check-replies/route.ts` + `lib/reply-agent/*`
- Récupère les réponses (`getInstantlyReplies`), dédup (unique index + contenu).
- `stripQuotedReply()` isole le vrai texte du prospect.
- `classifier.ts` : classe (interest/question/objection/rdv_request/desinterest/oof/spam). Pré-filtres hard-codés : opt-out, auto-réponse, **plainte "mail vide"** → no_action.
- `generator.ts` : rédige la réponse auto (avec l'**historique** de conversation pour ne pas se répéter).
- **RDV auto** : calcule un créneau (`lib/availability.ts`, en heure de Paris), crée l'évènement Google Calendar + Meet, facture Stripe (idempotent, seulement si vrai event), notifie le client (Resend).

### 7.7 Auto-apprentissage — `lib/experiments.ts` + `app/api/cron/self-improve/route.ts`
- Voir section 9.

---

## 8. Fonctionnalités transverses importantes

### 8.1 Anti-mail-vide
Double validation (générateur + envoi) + templates de secours. Aucun mail vide ne peut partir.

### 8.2 Anti-bounce
On n'envoie qu'aux emails **sûrs** (cliquables, confiance ≥ 90) OU **validés MillionVerifier**. Le reste attend en stock.

### 8.3 Filtre fake emails — `lib/fake-email.ts`
Bloque `nom@exemple.fr`, `test@`, `example.com`... **sans** bloquer les vrais domaines (`mail.com`) ni les patronymes en "-nom".

### 8.4 Dédup & anti-répétition
- Réponses : unique index `instantly_reply_id` + `onConflictDoNothing` + dédup contenu.
- L'agent voit ses propres réponses passées (historique) → ne se répète pas.

### 8.5 Opt-out RGPD
Emails normalisés en minuscules partout. "Stop" → blocklist → annulation immédiate des relances.

### 8.6 Fuseau horaire
Serveur Vercel = UTC. Tout le calcul de créneau RDV en **Europe/Paris** (`toParisWallClock`, `toNaiveParisISO`), envoyé à Google Agenda en ISO local + `timeZone`.

---

## 9. Le système d'auto-apprentissage (100% autonome)

Principe : **les réglages testés sont des DONNÉES** (dans `agent_config`, en JSON), pas du code. L'agent les réécrit lui-même.

- **Leviers** (`lib/experiments.ts`) : `exp_variant_weights` (angles de message), `exp_sector_weights` (secteurs), `exp_region_weights` (régions). Chaque valeur a un poids, avec un **plancher d'exploration** (`MIN_WEIGHT`) → l'agent teste toujours un peu tout.
- **Marquage** : chaque email envoyé est tagué (`variant_id`), et son contact porte secteur+ville.
- **Le cerveau** (`self-improve`, mensuel) :
  1. Mesure, sur 30 jours, les **vraies réponses** (arrivées APRÈS l'envoi, hors spam) + RDV, par variante/secteur/région.
  2. Score combiné = `taux_réponse + 3 × taux_RDV`.
  3. Recalcule les poids (**garde-fous** : minimum d'envois avant de truster, plancher d'exploration, lissage anti-swing).
  4. Réécrit les poids en base + envoie un rapport.
- `scrape-leads` lit `sector/region_weights`, `autopilot-tick` lit `variant_weights`. La boucle est fermée.

> ⚠️ N'a de sens qu'avec du VOLUME. Au début l'agent explore (peu de data). C'est un marathon.

---

## 10. Le dashboard (pages Next.js)

`app/page.tsx` (suivi leads), `leads`, `agenda`, `conversations` (messagerie), `reponses-a-valider`, `analytique`/`stats`, `learning` (auto-learning), `campagnes`, `parametres`, `login`.
APIs qui les alimentent : `/api/stats/analytics`, `/api/conversations`, `/api/leads`, `/api/rdv`, `/api/learning/reports`, `/api/dashboard/stream` (SSE temps réel).
Auth : middleware `proxy.ts` (protège tout sauf `/login`, `/api/auth`, `/api/cron`).

Endpoints admin one-shot utiles : `/api/admin/preview-email` (prévisualise les mails générés sans envoyer), `/api/admin/reclassify` (reclasse les réponses), `/api/admin/resend-broken` (relance des contacts).

---

## 11. ⚠️⚠️ LES ERREURS RENCONTRÉES — À NE JAMAIS REFAIRE

**C'est la section la plus importante. Chaque point nous a coûté du temps sur ce projet.**

1. **Mails vides.** Cause : template Instantly sans `{{body}}`/`{{subject}}`, OU `generateSequence` qui renvoie < 4 emails ou des bodies vides. → Le template Instantly DOIT avoir les 4 variables ; le code DOIT garantir 4 emails non-vides (filtre + templates de secours + refus d'envoi si initial vide).

2. **Relances vides sur les vieux leads.** Les leads déjà dans Instantly avec des variables de relance vides continuent d'envoyer du vide. → On ne peut PAS réparer les leads déjà poussés. Solution : **repartir sur une campagne Instantly neuve** (dupliquer, 0 lead) et re-pousser proprement.

3. **Crons en 401 (auth).** cron-job.org peut ajouter `%cjo:uuid4%%cjo:unixtime%` au header → le token change à chaque appel → un match EXACT échoue → l'agent ne fait plus rien. → Auth **tolérante au préfixe** (`lib/cron-auth.ts`).

4. **Vercel n'auto-déploie plus.** L'intégration GitHub→Vercel peut se déconnecter silencieusement (les pushes ne se déploient pas). → Vérifier que le dernier déploiement correspond au dernier commit ; sinon **déployer via CLI** : `npx vercel --prod --yes`.

5. **Timeouts (30s).** Cause : scraping + audit + génération + envoi entassés dans un seul cron. → **Découpler** (un cron par étape lourde) + `export const maxDuration = 60`.

6. **RDV à la mauvaise heure.** Serveur en UTC → un créneau "14h" devient 16h. → Calculer en **Europe/Paris** et envoyer un ISO local (sans `Z`) + `timeZone: 'Europe/Paris'` à Google.

7. **Migration DB manquante avant déploiement.** Déployer du code qui écrit une colonne/contrainte inexistante → crash runtime (et pour `email_queue`, doublons d'envoi). → **Lancer la migration SQL AVANT le déploiement**. `onConflictDoNothing()` sans cible marche même avant la contrainte unique.

8. **Mauvaise URL de dashboard.** Les URLs avec un hash (`projet-xxxxx.vercel.app`) sont des **déploiements figés** (vieux code, vieux CSS). → Toujours utiliser l'alias stable `projet.vercel.app` (mettre en favori).

9. **Stats gonflées.** Compter "tout contact ayant répondu un jour" attribue les vieilles plaintes aux envois récents. → Ne compter une réponse que si elle arrive **APRÈS l'envoi** ET qu'elle n'est pas du spam/auto-réponse.

10. **Bug d'affichage ×100.** `reply_rate` stocké EN pourcentage (46.3) mais affiché `× 100` → 4630%. → Ne pas re-multiplier côté front.

11. **Double facturation Stripe.** → `idempotencyKey` sur la charge + ne facturer QUE sur un vrai RDV Google (pas un event mock).

12. **Bounces.** Envoyer sur des `contact@` devinés → bounces → réputation. → N'envoyer qu'aux **sûrs** (cliquables) ou **validés MillionVerifier** ; garder les incertains en stock.

13. **Opt-out ignoré (RGPD).** Blocklist sensible à la casse → un "Stop" pouvait passer. → Normaliser les emails en minuscules partout.

14. **L'agent se répète.** Il générait la même réponse car il ne voyait pas ses réponses passées. → Lui passer l'**historique** de conversation.

15. **Mails trop longs / génériques.** Un prompt "consultant senior" de 150 mots → trop dense pour un artisan, et générique quand l'audit manque. → Style **court, simple, une idée, ouvre sur le vrai défaut audité**. Et **auditer AVANT d'envoyer** (garde-fou `audit_done`).

16. **Auto-apprentissage qui apprend du bruit.** Sans garde-fous, il "gagne" sur 4 envois (hasard). → Minimum d'échantillon avant de truster + plancher d'exploration + lissage.

17. **Plan Vercel Hobby.** Les crons Vercel = daily-only et limités → utiliser **cron-job.org** pour les fréquences fines. Timeout fonction Hobby = 60s max (`maxDuration = 60`).

18. **cron-job.org "TEST RUN" ≠ cron programmé.** Bien vérifier que chaque tâche a un **planning** (pas juste testée).

---

## 12. Checklist de lancement A→Z (nouveau client)

1. [ ] Créer le repo (copie de celui-ci) + adapter le secteur/cibles (`lib/scrape-targets.ts`) et le persona/offre (`lib/email-generator.ts`, `data/sequence.ts`).
2. [ ] Créer la base **Neon** → `DATABASE_URL`.
3. [ ] `npm run db:push` (ou SQL manuel) + lancer les **migrations** (section 5).
4. [ ] Créer la campagne **Instantly** (4 steps avec `{{body}}`...), connecter + warm-up les boîtes.
5. [ ] Récupérer toutes les clés API (section 3) et les mettre dans **Vercel** (Production).
6. [ ] Déployer sur Vercel (vérifier que le déploiement est bien à jour).
7. [ ] Créer une ligne `campaigns` active en base avec le bon `instantly_campaign_id`.
8. [ ] Créer les **crons** sur cron-job.org (section 6) avec le header Bearer.
9. [ ] Lancer un **TEST RUN** de chaque cron → vérifier `200 OK` et le JSON de réponse.
10. [ ] Prévisualiser les mails : `/api/admin/preview-email` (connecté au dashboard).
11. [ ] Laisser tourner, surveiller la boîte Gmail des inbox (contenu OK, pas de vide, pas de bounce) sur 3-7 jours.
12. [ ] (Quand budget) Ajouter **MillionVerifier** + le cron `validate-emails` → débloque le gros volume.

---

## 13. Adapter à un autre secteur / région

- **Cibles** : éditer `lib/scrape-targets.ts` (`SECTOR_QUERIES` = termes de recherche Google + secteurs ; `CITIES_BY_REGION` = zones).
- **Persona & offre** : éditer le `SYSTEM_PROMPT` et l'offre dans `lib/email-generator.ts`, et les templates de secours dans `data/sequence.ts`.
- **Signature** : les tokens `Thomas Renard` / `thomas@hdigiweb.fr` sont remplacés par l'inbox réelle → garder ces tokens dans le prompt.
- **Vocabulaire métier** : `sectorHints` dans `lib/email-generator.ts` (évite de parler toiture à un pisciniste).
- Tout le reste (pipeline, crons, auto-apprentissage) est **générique** et se réutilise tel quel.

---

---

## 14. Annexe — TOUTES les routes API (pour ne rien oublier)

**Crons (`/api/cron/…`)** : `scrape-leads`, `audit-sites`, `validate-emails`, `autopilot-tick`, `check-replies`, `self-improve` (les 6 actifs) · `morning-digest`, `weekly-learning` (remplacé), `backfill-sequences` (obsolète), `strategy-agent`, `debug-hot-leads`, `manual-relay` (secondaires).

**Admin one-shot (`/api/admin/…`)** : `preview-email` (prévisualise les mails sans envoyer), `reclassify` (reclasse les réponses), `resend-broken` (relance des contacts). Tous protégés par la session (middleware).

**Dashboard / données** : `stats/analytics`, `conversations`, `dashboard/summary`, `dashboard/stream` (SSE temps réel), `leads`, `leads/[id]`, `rdv`, `rdv/[id]`, `learning/reports`, `learning/reports/[id]`, `campaigns`, `settings` (lit/écrit `agent_config`), `notifications/rdv`.

**Réponses (validation manuelle)** : `replies`, `replies/[id]/draft`, `replies/[id]/reject`, `replies/[id]/send`, `reply-drafts`, `reply-drafts/[id]`.

**Génération / scrape manuel / test** : `generate-email` (1 email à la demande), `leads/import` (import CSV), `leads/scrape` (scrape manuel, auth ADMIN_API_KEY / NEXT_PUBLIC_SCRAPE_TOKEN), `simulate-send` (test sans envoi réel).

**Stripe** : `stripe/setup` + `stripe/create-setup-session` (enregistrer la CB du client), `stripe/webhook`.

**Auth** : `auth/[...nextauth]` (NextAuth).

> Le **cœur** du système = les 6 crons actifs + les libs. Le reste sert le dashboard, les tests, ou est du legacy conservé.

## 15. Fichiers clés (où est quoi)

| Besoin | Fichier |
|--------|---------|
| Schéma DB | `lib/db/schema.ts` · connexion : `lib/db/index.ts` |
| Wrapper IA (Gemini) | `lib/ai.ts` |
| Génération d'emails + prompt | `lib/email-generator.ts` |
| Templates de secours | `data/sequence.ts` |
| Cibles (secteurs/villes) | `lib/scrape-targets.ts` |
| Scraping Google | `lib/scraper/google-places.ts` |
| Audit de site | `lib/website-audit.ts` |
| Validation email (module) | `lib/scraper/email-validator.ts` |
| Filtre fake emails | `lib/fake-email.ts` |
| Client Instantly | `lib/instantly/client.ts` · rotation : `lib/instantly/inbox-rotation.ts` |
| Réponses (classer/rédiger) | `lib/reply-agent/classifier.ts` · `lib/reply-agent/generator.ts` |
| Créneaux RDV (timezone) | `lib/availability.ts` |
| Google Calendar | `lib/google-calendar.ts` |
| Stripe | `lib/stripe.ts` |
| Auto-apprentissage (leviers) | `lib/experiments.ts` |
| Auth cron | `lib/cron-auth.ts` |
| Middleware auth dashboard | `proxy.ts` |
| Config crons Vercel | `vercel.json` |

---

## 16. Opérations manuelles utiles (SQL Neon)

### Changement d'adresse email d'un prospect (rattrapage manuel)
> Automatique depuis le fix `extractNewEmail` (check-replies) pour les nouvelles réponses.
> Ce SQL sert pour les cas déjà traités ou une formulation ratée par l'auto-détection.
```sql
-- Remplace ANCIENNE_ADRESSE / NOUVELLE_ADRESSE
UPDATE contacts
SET email = 'NOUVELLE_ADRESSE', email_validated = true, email_confidence_score = 99, updated_at = now()
WHERE email = 'ANCIENNE_ADRESSE';

UPDATE email_queue
SET status = 'pending', scheduled_at = now(), sent_at = null, sequence_step = 0,
    subject = '__pending_generation__', body = '__pending_generation__'
WHERE contact_id = (SELECT id FROM contacts WHERE email = 'NOUVELLE_ADRESSE');
```
⚠️ Si NOUVELLE_ADRESSE existe déjà comme autre contact → la 1ère requête échoue (unicité).

### Relancer un contact (re-générer + renvoyer)
```sql
UPDATE email_queue SET status='pending', scheduled_at=now(), sent_at=null, sequence_step=0,
  subject='__pending_generation__', body='__pending_generation__'
WHERE contact_id = (SELECT id FROM contacts WHERE email = 'EMAIL');
```

### Diagnostic rapide (état du système)
```sql
SELECT status, count(*) FROM email_queue GROUP BY status;            -- file d'envoi
SELECT count(*) FROM contacts WHERE audit_done = false;               -- reste à auditer
SELECT count(*) FROM contacts WHERE email_validated = false;          -- reste à valider
SELECT id, name, status, instantly_campaign_id FROM campaigns;        -- campagne active
```

---

*Dernière mise à jour : construit à partir du projet agent-couvreurs (Hdigiweb), juillet 2026.*
