/**
 * `npm run db:push` NE DOIT PLUS RIEN POUSSER — et voici pourquoi.
 *
 * ⚠️ TREIZE TABLES DE PRODUCTION VIVENT EN DEHORS DE `lib/db/schema.ts`. Elles ont été créées au fil de
 * l'eau par des `CREATE TABLE IF NOT EXISTS` dans les crons qui en avaient besoin. `drizzle-kit push`
 * compare le schéma déclaré à la base et **SUPPRIME tout ce qui n'y figure pas**. Une seule commande,
 * lancée de bonne foi après une modification de schéma, effacerait (liste re-mesuree le 26/08 contre information_schema) :
 *
 *   cron_heartbeats         tout l'historique de surveillance des crons
 *   rdv_rappels             les traces de rappels déjà envoyés → tous les rappels repartiraient
 *   urgent_tasks            les tâches signalées à traiter à la main
 *   messages_humains        la détection des réponses écrites à la main depuis Gmail
 *   imap_messages_ecartes   la mémoire des messages déjà écartés → re-téléchargés à chaque passage
 *   villes_scraping         les 5 564 communes du plan de couverture nationale
 *   scrape_couverture       LA MÉMOIRE ANTI-RACHAT — sans elle on repaie Paris, Lyon, Toulouse
 *   achat_commandes         le suivi des dépenses Outscraper
 *   achat_config            l'arrêt d'urgence des achats
 *   outscraper_leads        la zone de transit des leads achetés, plusieurs milliers de lignes
 *
 * Signalé par la session Optimum lors de l'audit croisé du 26/08. Le risque n'est pas théorique :
 * `db:push` figurait dans les scripts npm, à une faute de frappe d'un `db:generate`.
 *
 * ⚠️ POURQUOI ON NE S'EST PAS CONTENTÉ DE DÉCLARER LES DIX TABLES. Les écrire à la main, de mémoire,
 * puis lancer `push` est encore plus dangereux : un type de colonne approximatif ne provoque pas une
 * erreur, il provoque un ALTER destructeur. Pour les réintégrer proprement il faut les INTROSPECTER
 * depuis la base réelle (`drizzle-kit pull`), relire le résultat, et seulement ensuite envisager de
 * pousser. Tant que ce travail n'est pas fait, la commande reste fermée.
 *
 * Pour une modification de schéma en attendant : écrire la migration à la main dans
 * `app/api/admin/migrate/route.ts`, qui procède par `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` et
 * n'a jamais supprimé quoi que ce soit.
 */
console.error(`
  ✗ db:push est désactivé volontairement.

  drizzle-kit push SUPPRIME les tables absentes de lib/db/schema.ts.
  Treize tables de production vivent en dehors du schéma, dont scrape_couverture
  (la mémoire anti-rachat) et villes_scraping (5 564 communes).

  Pour modifier le schéma : ajouter une étape dans app/api/admin/migrate/route.ts
  (ALTER TABLE ... ADD COLUMN IF NOT EXISTS), puis appeler /api/admin/migrate.

  Détail complet dans scripts/refus-db-push.js.
`)
process.exit(1)
