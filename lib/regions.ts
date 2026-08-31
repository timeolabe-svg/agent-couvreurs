/**
 * CORRESPONDANCE DÉPARTEMENT → RÉGION.
 *
 * ⚠️ POURQUOI CE FICHIER EXISTE (31/08/2026). L'auto-apprentissage note les régions selon ce
 * qu'elles rapportent — mesuré ce jour-là :
 *
 *   Hauts-de-France      0,733      Auvergne-Rhône-Alpes  0,107
 *   Nouvelle-Aquitaine   0,589      Normandie             0,107
 *   Grand Est            0,558      Bretagne              0,130
 *
 * Or le plan d'achat de leads choisissait le prochain département par sa POPULATION. Il s'apprêtait
 * donc à acheter quinze villes du Rhône — c'est-à-dire la région qui convertit le moins bien de
 * toutes, à peine au-dessus du plancher. On aurait payé des fiches là où l'on sait déjà qu'elles
 * répondent le moins.
 *
 * Le système savait, et ne s'en servait pas : l'information vivait dans `exp_region_weights` et le
 * choix du département l'ignorait. C'est le motif de la journée — une règle vraie quelque part,
 * sans effet là où elle compte.
 */

/** Régions métropolitaines, avec leurs départements. Corse et outre-mer inclus pour l'exhaustivité. */
export const DEPARTEMENTS_PAR_REGION: Record<string, string[]> = {
  'Île-de-France': ['75', '77', '78', '91', '92', '93', '94', '95'],
  'Auvergne-Rhône-Alpes': ['01', '03', '07', '15', '26', '38', '42', '43', '63', '69', '73', '74'],
  'PACA': ['04', '05', '06', '13', '83', '84'],
  'Nouvelle-Aquitaine': ['16', '17', '19', '23', '24', '33', '40', '47', '64', '79', '86', '87'],
  'Occitanie': ['09', '11', '12', '30', '31', '32', '34', '46', '48', '65', '66', '81', '82'],
  'Grand Est': ['08', '10', '51', '52', '54', '55', '57', '67', '68', '88'],
  'Hauts-de-France': ['02', '59', '60', '62', '80'],
  'Normandie': ['14', '27', '50', '61', '76'],
  'Bretagne': ['22', '29', '35', '56'],
  'Pays de la Loire': ['44', '49', '53', '72', '85'],
  'Centre-Val de Loire': ['18', '28', '36', '37', '41', '45'],
  'Bourgogne-Franche-Comté': ['21', '25', '39', '58', '70', '71', '89', '90'],
  'Corse': ['2A', '2B', '20'],
}

/** Index inverse, construit une fois : département → région. */
const REGION_DE: Record<string, string> = (() => {
  const m: Record<string, string> = {}
  for (const [region, depts] of Object.entries(DEPARTEMENTS_PAR_REGION)) {
    for (const d of depts) m[d] = region
  }
  return m
})()

/**
 * Région d'un département. Tolère « 6 » comme « 06 » : les codes arrivent parfois sans zéro initial
 * selon la source, et une correspondance ratée renverrait silencieusement au poids par défaut.
 */
export function regionDuDepartement(departement: string | null | undefined): string | null {
  if (!departement) return null
  const brut = String(departement).trim().toUpperCase()
  return REGION_DE[brut] ?? REGION_DE[brut.padStart(2, '0')] ?? null
}
