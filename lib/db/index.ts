import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import * as schema from './schema'

/**
 * ⚠️ `no-store` N'EST PAS UNE OPTION DE CONFORT (26/08, signalé par la session Revele).
 *
 * Le driver Neon parle en HTTP, donc Next.js met ses requêtes en cache comme n'importe quel `fetch`.
 * Sans ce réglage, une lecture peut renvoyer un état PÉRIMÉ : un contact qu'on vient de blocklister
 * revient « non bloqué », un mail déjà envoyé revient « en file ». Sur un moteur d'envoi, une lecture
 * périmée ne produit pas une erreur, elle produit un doublon — et personne ne le voit.
 *
 * Le correctif est en place depuis longtemps sur agent-revele et labegaria-app ; il n'avait jamais
 * été porté ici.
 */
const sql = neon(process.env.DATABASE_URL!, { fetchOptions: { cache: 'no-store' } })
export const db = drizzle(sql, { schema })
export type DB = typeof db
// Accès SQL brut (pour requêtes complexes : moteur d'envoi maison, anti-répétition...).
export { sql }
