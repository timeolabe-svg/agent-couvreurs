// Détecte les adresses email BIDONS / placeholder qui ne doivent JAMAIS être
// contactées (elles bouncent → abîment la réputation d'envoi).
// Ex : nom@exemple.fr, test@test.com, votre@email.com, example@domain.com...

// UNIQUEMENT des domaines placeholder/exemple. On NE met PAS de vrais fournisseurs
// (mail.com, email.com, site.com sont de VRAIS domaines → bloquer serait un faux positif).
const FAKE_DOMAINS = new Set([
  'example.com', 'example.fr', 'example.org', 'example.net',
  'exemple.com', 'exemple.fr', 'exemple.org',
  'test.com', 'test.fr', 'domain.com', 'domaine.fr',
  'yourdomain.com', 'votredomaine.fr',
  'mondomaine.fr', 'sample.com', 'demo.com', 'localhost',
])

// Parties locales (avant le @) typiques de placeholders
const FAKE_LOCAL_PARTS = new Set([
  'nom', 'prenom', 'prénom', 'nomprenom', 'votrenom', 'name', 'yourname',
  'test', 'exemple', 'example', 'sample', 'demo', 'votre', 'your',
  'email', 'mail', 'adresse', 'address', 'nomdusite', 'xxx', 'aaa',
  'abc', 'test123', 'user', 'utilisateur',
])

export function isFakeEmail(email: string | null | undefined): boolean {
  if (!email) return true
  const e = email.trim().toLowerCase()
  if (!e.includes('@')) return true

  const [local, domain] = e.split('@')
  if (!local || !domain) return true

  if (FAKE_DOMAINS.has(domain)) return true
  if (FAKE_LOCAL_PARTS.has(local)) return true

  // Placeholders évidents dans l'adresse complète. On NE met PAS "nom@" ici : ça
  // bloquerait à tort un vrai patronyme finissant en "-nom" (ex: jean.desnom@...).
  // La partie locale exacte "nom" est déjà couverte par FAKE_LOCAL_PARTS.
  if (/(votre|your|ex(e|)mple|placeholder|no-?reply@example)/.test(e)) return true
  // Domaines de test génériques
  if (/@(example|exemple|test|domain|domaine|sample|demo)\./.test(e)) return true

  return false
}
