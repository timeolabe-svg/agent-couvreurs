// Détecte les adresses email BIDONS / placeholder qui ne doivent JAMAIS être
// contactées (elles bouncent → abîment la réputation d'envoi).
// Ex : nom@exemple.fr, test@test.com, votre@email.com, example@domain.com...

const FAKE_DOMAINS = new Set([
  'example.com', 'example.fr', 'example.org', 'example.net',
  'exemple.com', 'exemple.fr', 'exemple.org',
  'test.com', 'test.fr', 'domain.com', 'domaine.fr',
  'email.com', 'mail.com', 'yourdomain.com', 'votredomaine.fr',
  'mondomaine.fr', 'monsite.fr', 'site.com', 'website.com',
  'sample.com', 'demo.com', 'localhost', 'nom.fr',
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

  // Placeholders évidents dans l'adresse complète
  if (/(votre|your|ex(e|)mple|placeholder|no-?reply@example|nom@)/.test(e)) return true
  // Domaines de test génériques
  if (/@(example|exemple|test|domain|domaine|sample|demo)\./.test(e)) return true

  return false
}
