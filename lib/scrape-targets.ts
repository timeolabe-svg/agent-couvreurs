// Cibles de scraping partagées (secteurs BTP + villes France par région).
// Utilisé par le cron scrape-leads et le moteur d'auto-apprentissage.
// L'email étant personnalisé avec la ville du prospect, le ciblage reste local.

export const SECTOR_QUERIES: { term: string; sector: string }[] = [
  // Couvreurs
  { term: 'couvreur', sector: 'couvreur' },
  { term: 'charpentier couvreur', sector: 'couvreur' },
  { term: 'couvreur zingueur', sector: 'couvreur' },
  { term: 'entreprise de couverture', sector: 'couvreur' },
  { term: 'réparation toiture', sector: 'couvreur' },
  { term: 'rénovation toiture', sector: 'couvreur' },
  { term: 'étanchéité toiture', sector: 'couvreur' },
  // Terrassiers
  { term: 'terrassier', sector: 'terrassier' },
  { term: 'entreprise de terrassement', sector: 'terrassier' },
  { term: 'terrassement', sector: 'terrassier' },
  { term: 'travaux terrassement VRD', sector: 'terrassier' },
  { term: 'assainissement terrassement', sector: 'terrassier' },
  // Piscinistes
  { term: 'pisciniste', sector: 'pisciniste' },
  { term: 'construction piscine', sector: 'pisciniste' },
  { term: 'rénovation piscine', sector: 'pisciniste' },
  { term: 'installation piscine', sector: 'pisciniste' },
  // Maçons
  { term: 'maçon', sector: 'maçon' },
  { term: 'maçonnerie', sector: 'maçon' },
  { term: 'entreprise maçonnerie', sector: 'maçon' },
  // Électriciens
  { term: 'électricien', sector: 'électricien' },
  { term: 'installateur électrique', sector: 'électricien' },
  // Plombiers
  { term: 'plombier', sector: 'plombier' },
  { term: 'plomberie chauffage', sector: 'plombier' },
  // Peintres
  { term: 'peintre en bâtiment', sector: 'peintre' },
  { term: 'peinture bâtiment', sector: 'peintre' },
  // Menuisiers
  { term: 'menuisier', sector: 'menuisier' },
  { term: 'menuiserie', sector: 'menuisier' },
]

// Liste unique des secteurs (pour l'auto-apprentissage / pondération).
export const SECTORS = [...new Set(SECTOR_QUERIES.map(q => q.sector))]

// Villes groupées par RÉGION (permet à l'agent de tester/pondérer les zones).
export const CITIES_BY_REGION: Record<string, string[]> = {
  'Île-de-France': [
    'Paris', 'Boulogne-Billancourt', 'Saint-Denis', 'Argenteuil', 'Montreuil',
    'Nanterre', 'Créteil', 'Versailles', 'Vitry-sur-Seine', 'Colombes',
    'Aulnay-sous-Bois', 'Asnières-sur-Seine', 'Courbevoie', 'Rueil-Malmaison',
    'Champigny-sur-Marne', 'Meaux', 'Cergy', 'Évry-Courcouronnes', 'Pontoise',
    'Mantes-la-Jolie', 'Melun', 'Étampes', 'Rambouillet',
  ],
  'Auvergne-Rhône-Alpes': [
    'Lyon', 'Villeurbanne', 'Grenoble', 'Saint-Étienne', 'Clermont-Ferrand',
    'Valence', 'Chambéry', 'Annecy', 'Annemasse', 'Bourg-en-Bresse', 'Roanne',
    'Vienne', 'Montluçon', 'Aurillac', 'Le Puy-en-Velay', 'Privas', 'Romans-sur-Isère',
    'Bourgoin-Jallieu', 'Thonon-les-Bains', 'Aix-les-Bains', 'Vichy', 'Moulins',
  ],
  'PACA': [
    'Marseille', 'Nice', 'Toulon', 'Aix-en-Provence', 'Avignon', 'Antibes',
    'Cannes', 'La Seyne-sur-Mer', 'Hyères', 'Fréjus', 'Grasse', 'Martigues',
    'Cagnes-sur-Mer', 'Gap', 'Digne-les-Bains', 'Draguignan', 'Manosque', 'Salon-de-Provence',
  ],
  'Nouvelle-Aquitaine': [
    'Bordeaux', 'Limoges', 'Poitiers', 'Pau', 'La Rochelle', 'Mérignac',
    'Pessac', 'Angoulême', 'Niort', 'Bayonne', 'Périgueux', 'Agen', 'Mont-de-Marsan',
    'Brive-la-Gaillarde', 'Bergerac', 'Saintes', 'Rochefort', 'Biarritz', 'Anglet',
    'Villeneuve-sur-Lot', 'Tulle', 'Guéret',
  ],
  'Occitanie': [
    'Toulouse', 'Montpellier', 'Nîmes', 'Perpignan', 'Carcassonne', 'Béziers',
    'Albi', 'Tarbes', 'Auch', 'Cahors', 'Rodez', 'Castres', 'Sète', 'Narbonne',
    'Montauban', 'Muret', 'Blagnac', 'Colomiers', 'Alès', 'Lourdes', 'Foix', 'Mende',
  ],
  'Grand Est': [
    'Strasbourg', 'Reims', 'Metz', 'Nancy', 'Mulhouse', 'Colmar', 'Troyes',
    'Charleville-Mézières', 'Châlons-en-Champagne', 'Épinal', 'Thionville', 'Haguenau',
    'Schiltigheim', 'Saint-Dizier', 'Verdun', 'Chaumont', 'Bar-le-Duc',
  ],
  'Hauts-de-France': [
    'Lille', 'Amiens', 'Roubaix', 'Tourcoing', 'Dunkerque', 'Calais', 'Villeneuve-d\'Ascq',
    'Saint-Quentin', 'Beauvais', 'Valenciennes', 'Boulogne-sur-Mer', 'Compiègne',
    'Arras', 'Douai', 'Lens', 'Béthune', 'Soissons', 'Cambrai', 'Maubeuge', 'Laon',
  ],
  'Normandie': [
    'Rouen', 'Le Havre', 'Caen', 'Cherbourg-en-Cotentin', 'Évreux', 'Dieppe',
    'Saint-Lô', 'Alençon', 'Lisieux', 'Vernon', 'Bayeux',
  ],
  'Bretagne': [
    'Rennes', 'Brest', 'Quimper', 'Lorient', 'Vannes', 'Saint-Malo', 'Saint-Brieuc',
    'Lannion', 'Concarneau', 'Fougères', 'Lamballe', 'Morlaix',
  ],
  'Pays de la Loire': [
    'Nantes', 'Angers', 'Le Mans', 'Saint-Nazaire', 'Cholet', 'La Roche-sur-Yon',
    'Laval', 'Saumur', 'La Baule-Escoublac', 'Les Sables-d\'Olonne', 'Château-Gontier',
  ],
  'Centre-Val de Loire': [
    'Tours', 'Orléans', 'Bourges', 'Blois', 'Châteauroux', 'Chartres', 'Dreux',
    'Vierzon', 'Montargis', 'Vendôme', 'Romorantin-Lanthenay',
  ],
  'Bourgogne-Franche-Comté': [
    'Dijon', 'Besançon', 'Belfort', 'Chalon-sur-Saône', 'Nevers', 'Auxerre',
    'Mâcon', 'Montbéliard', 'Sens', 'Le Creusot', 'Dole', 'Vesoul', 'Lons-le-Saunier',
  ],
  'Corse': ['Ajaccio', 'Bastia', 'Porto-Vecchio', 'Calvi'],
}

export const REGIONS = Object.keys(CITIES_BY_REGION)

// Liste plate de toutes les villes (compat).
export const CITIES = Object.values(CITIES_BY_REGION).flat()

// Map ville → région (pour attribuer les résultats à une zone lors de la mesure).
export const CITY_TO_REGION: Record<string, string> = Object.fromEntries(
  Object.entries(CITIES_BY_REGION).flatMap(([region, cities]) => cities.map(c => [c, region]))
)
