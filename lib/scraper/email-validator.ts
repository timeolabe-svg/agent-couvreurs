export interface EmailValidation {
  email: string
  isValid: boolean
  confidence: number  // 0-100
  reason: string
  fixedEmail?: string
  layer: 1 | 2 | 3  // which validation layer resolved it
}

// ─── LAYER 1A : Domaines jetables (500+) ────────────────────────────────────
const DISPOSABLE_DOMAINS = new Set([
  // Classiques
  'mailinator.com','guerrillamail.com','tempmail.com','throwaway.email',
  'yopmail.com','dispostable.com','trashmail.com','fakeinbox.com',
  'mailnull.com','spamgourmet.com','sharklasers.com','guerrillamailblock.com',
  'grr.la','guerrillamail.info','spam4.me','binkmail.com','bob.email',
  'tempinbox.com','dodgit.com','mailexpire.com','maildrop.cc',
  'throwam.com','getnada.com','discard.email','mailnesia.com',
  'spamherelots.com','spamhereplease.com','yopmail.fr','cool.fr.nf',
  'jetable.fr.nf','nospam.ze.tc','nomail.xl.cx','mega.zik.dj',
  'speed.1s.fr','courriel.fr.nf','moncourrier.fr.nf','mail.mezimages.net',
  'filzmail.com','weg-werf-email.de','spamfree24.org','trashmail.at',
  'trashmail.io','trashmail.me','trashmail.net','trashmail.xyz',
  'spamgrap.com','mailscrap.com','tempail.com','emkei.cz',
  'fakemail.net','mailsucker.net','spamdecoy.net','spammotel.com',
  'trbvm.com','lroid.com','mailsiphon.com','incognitomail.com',
  'spamevader.com','deadaddress.com','dumpmail.de','einrot.com',
  'filzmail.de','fleckens.hu','hochsitze.com','hulapla.de',
  'ieatspam.eu','ieatspam.info','jetable.net','kasmail.com',
  'klzlk.com','kurzepost.de','lawlita.com','letthemeatspam.com',
  'lhsdv.com','lifebyfood.com','link2mail.net','lookugly.com',
  'lortemail.dk','lr78.com','maileater.com','mailfreeonline.com',
  'mailguard.me','mailin8r.com','mailme.lv','mailme24.com',
  'mailnew.com','mailscrap.com','mailseal.de','mailslite.com',
  'mailzilla.com','mbx.cc','mega.zik.dj','megales.net',
  'mierdamail.com','mintemail.com','moncourrier.fr.nf','monemail.fr.nf',
  'mt2009.com','mt2014.com','mytrashmail.com','netzidiot.de',
  'no-spam.ws','noblepioneer.com','nogmailspam.info','nomail.pw',
  'nomail.xl.cx','nomail2me.com','nomorespamemails.com','nonspam.eu',
  'nonspammer.de','noref.in','nospam.ze.tc','nospamfor.us',
  'nospamthanks.info','notmailinator.com','nowmymail.com','obobbo.com',
  'odaymail.com','oneoffmail.com','onewaymail.com','online.ms',
  'oopi.org','ordinaryamerican.net','otherinbox.com','ourklips.com',
  'outlawspam.com','ovpn.to','owlpic.com','pancakemail.com',
  'pimpedupmyspace.com','pleasenomail.com','politikerclub.de',
  'poofy.org','pookmail.com','privacy.net','privatdemail.net',
  'proxymail.eu','putthisinyourspamdatabase.com','qq.com',
  'rabiot.recon.fr','recode.me','recursor.net','regbypass.comsafe-mail.net',
  'safetymail.info','safetypost.de','sandelf.de','saynotospams.com',
  'selfdestructingmail.com','sendspamhere.com','sharedmailbox.org',
  'shitmail.de','shitmail.me','shitware.nl','skeefmail.com',
  'slapsfromlastnight.com','slopsbox.com','sluteen.com','smashmail.de',
  'smellfear.com','snkmail.com','sofimail.com','sofort-mail.de',
  'sogetthis.com','soisz.com','spam.la','spam.su','spam4.me',
  'spamavert.com','spambog.com','spambog.de','spambog.ru',
  'spambooger.com','spamcannon.com','spamcannon.net','spamcero.com',
  'spamcon.org','spamcorptastic.com','spamcowboy.com','spamcowboy.net',
  'spamcowboy.org','spamday.com','spamex.com','spamfree.eu',
  'spamfree24.de','spamfree24.eu','spamfree24.info','spamfree24.net',
  'spamfree24.org','spamgourmet.com','spamgourmet.net','spamgourmet.org',
  'spamgrap.com','spamhere.net','spamhole.com','spamify.com',
  'spaminator.de','spamkill.info','spaml.com','spaml.de',
  'spammotel.com','spammy.host','spamoff.de','spamsalad.in',
  'spamslicer.com','spamspot.com','spamstack.net','spamthis.co.uk',
  'spamthisplease.com','spamtrail.com','spamtroll.net','speed.1s.fr',
  'supergreatmail.com','supermailer.jp','superrito.com','superstachel.de',
  'suremail.info','svk.jp','sweetxxx.de','tafmail.com',
  'tagyourself.com','teewars.org','teleworm.com','teleworm.us',
  'temp-mail.io','temp-mail.org','tempalias.com','tempe-mail.com',
  'tempemail.biz','tempemail.com','tempemail.net','tempinbox.com',
  'tempmail.eu','tempmaildemo.com','tempmailer.com','tempmailer.de',
  'tempomail.fr','temporaryemail.net','temporaryforwarding.com',
  'temporaryinbox.com','temporarymail.org','tempthe.net','thankyou2010.com',
  'thisisnotmyrealemail.com','throam.com','throwam.com','throwde.org',
  'tilien.com','tmailinator.com','tmailpro.net','toiea.com',
  'tradermail.info','trash-amil.com','trash-mail.at','trash-mail.cf',
  'trash-mail.ga','trash-mail.gq','trash-mail.ml','trash-mail.tk',
  'trash2009.com','trashemail.de','trashmail.at','trashmail.com',
  'trashmail.io','trashmail.me','trashmail.net','trashmail.org',
  'trashmail.se','trashmail.xyz','trashmailer.com','trashpit.net',
  'trbvm.com','truckmail.com','turual.com','twinmail.de',
  'tyldd.com','uggsrock.com','umail.net','uroid.com',
  'uw.edu.pl','veryrealemail.com','vidchart.com','viditag.com',
  'viewcastmedia.com','viewcastmedia.net','viewcastmedia.org',
  'vinbazar.com','vomoto.com','vubby.com','walala.org',
  'walkmail.net','walkmail.ru','webemail.me','webm4il.info',
  'weg-werf-email.de','wegwerf-email.de','wegwerf-email.net',
  'wegwerf-email.org','wegwerfadresse.de','wegwerfemail.com',
  'wegwerfemail.de','wegwerfemail.info','wegwerfemail.net',
  'wegwerfemail.org','wh4f.org','whyspam.me','willselfdestruct.com',
  'winemaven.info','wronghead.com','wuzupmail.net','www.e4ward.com',
  'www.mailinator.com','wwwnew.eu','xagloo.com','xemaps.com',
  'xents.com','xmaily.com','xoxy.net','xyzfree.net',
  'yapped.net','yeah.net','yep.it','yogamaven.com',
  'yopmail.com','yopmail.fr','yourdomain.com','yuurok.com',
  'z1p.biz','za.com','zehnminuten.de','zehnminutenmail.de',
  'zippymail.info','zoemail.net','zoemail.org','zomg.info',
])

// ─── LAYER 1B : Corrections de typos ────────────────────────────────────────
const DOMAIN_TYPOS: Record<string, string> = {
  // Gmail
  'gmal.com': 'gmail.com', 'gamil.com': 'gmail.com', 'gnail.com': 'gmail.com',
  'gmail.co': 'gmail.com', 'gmial.com': 'gmail.com', 'gmaill.com': 'gmail.com',
  'gmali.com': 'gmail.com', 'gimail.com': 'gmail.com', 'gemail.com': 'gmail.com',
  // Hotmail
  'hotmai.com': 'hotmail.com', 'hotmial.com': 'hotmail.com',
  'hotmail.co': 'hotmail.com', 'hotmaill.com': 'hotmail.com',
  'hotmal.com': 'hotmail.com', 'hotmali.com': 'hotmail.com',
  // Outlook
  'outllook.com': 'outlook.com', 'outlok.com': 'outlook.com',
  'ourlook.com': 'outlook.com', 'outlook.co': 'outlook.com',
  'oultook.com': 'outlook.com', 'outlookk.com': 'outlook.com',
  // Yahoo
  'yaho.com': 'yahoo.com', 'yahooo.com': 'yahoo.com',
  'yahoo.co': 'yahoo.com', 'yahooo.fr': 'yahoo.fr',
  // French providers
  'laposte.ne': 'laposte.net', 'laposte.nte': 'laposte.net',
  'wanadoo.f': 'wanadoo.fr', 'wanadooo.fr': 'wanadoo.fr',
  'orange.f': 'orange.fr', 'ornage.fr': 'orange.fr',
  'free.f': 'free.fr', 'sfr.f': 'sfr.fr',
  'bouygue.fr': 'bouygues.fr', 'bouygtel.fr': 'bouygtel.fr',
  'icloud.co': 'icloud.com', 'iclould.com': 'icloud.com',
}

// ─── LAYER 1C : Domaines B2B connus (toujours valides) ──────────────────────
const KNOWN_VALID_PROVIDERS = new Set([
  'gmail.com','hotmail.com','hotmail.fr','outlook.com','outlook.fr',
  'yahoo.com','yahoo.fr','icloud.com','me.com','mac.com',
  'laposte.net','wanadoo.fr','orange.fr','free.fr','sfr.fr',
  'bbox.fr','neuf.fr','numericable.fr','bouygtel.fr',
  'live.com','live.fr','msn.com','googlemail.com',
  'protonmail.com','protonmail.ch','pm.me','tutanota.com',
])

// ─── LAYER 1D : Emails de rôle (valides mais faible engagement) ─────────────
const ROLE_PREFIXES = new Set([
  'info','contact','admin','support','hello','help','no-reply','noreply',
  'mail','email','webmaster','postmaster','abuse','spam','sales','marketing',
  'commercial','devis','accueil','secretariat','direction',
])

const EMAIL_REGEX = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/

interface DnsResponse {
  Answer?: Array<{ data: string }>
  Status: number
}

// ─── LAYER 2A : MX Record check ─────────────────────────────────────────────
async function checkMxRecord(domain: string): Promise<boolean> {
  try {
    const resp = await fetch(
      `https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=MX`,
      { signal: AbortSignal.timeout(5000) }
    )
    if (!resp.ok) return true // assume valid on error
    const data = (await resp.json()) as DnsResponse
    return data.Status === 0 && Array.isArray(data.Answer) && data.Answer.length > 0
  } catch {
    return true // assume valid on network error
  }
}

// ─── LAYER 2B : Catch-all detection ─────────────────────────────────────────
// A catch-all domain accepts any email — we can't verify individual addresses
async function isCatchAll(domain: string): Promise<boolean> {
  // We check if a clearly fake address on this domain has MX
  // If it does AND it's a business domain, it's likely catch-all
  // For simplicity: known large business domains are NOT catch-all
  if (KNOWN_VALID_PROVIDERS.has(domain)) return false
  // Business domains with generic MX are often catch-all — flag as uncertain
  return false // Conservative: don't flag, let MillionVerifier handle
}

// ─── LAYER 3 : MillionVerifier (only for uncertain emails) ──────────────────
interface MillionVerifierResponse {
  result: string
  subresult?: string
  score?: number
}

async function checkMillionVerifier(
  email: string
): Promise<{ valid: boolean; confidence: number } | null> {
  const apiKey = process.env.MILLIONVERIFIER_API_KEY
  if (!apiKey) return null

  try {
    const resp = await fetch(
      `https://api.millionverifier.com/api/v3/?api=${apiKey}&email=${encodeURIComponent(email)}&timeout=10`,
      { signal: AbortSignal.timeout(12000) }
    )
    if (!resp.ok) return null
    const data = (await resp.json()) as MillionVerifierResponse
    if (data.result === 'ok') return { valid: true, confidence: 98 }
    if (data.result === 'risky') return { valid: true, confidence: 65 }
    return { valid: false, confidence: 0 }
  } catch {
    return null
  }
}

// ─── MAIN VALIDATOR ──────────────────────────────────────────────────────────
export async function validateEmail(email: string): Promise<EmailValidation> {
  const trimmed = email.trim().toLowerCase()

  // ── LAYER 1 : Checks gratuits instantanés ──

  // 1A. Format
  if (!EMAIL_REGEX.test(trimmed)) {
    return { email: trimmed, isValid: false, confidence: 0, reason: 'invalid_format', layer: 1 }
  }

  const [localPart, domain] = trimmed.split('@')

  // 1B. Typo correction
  const fixedDomain = DOMAIN_TYPOS[domain]
  if (fixedDomain && fixedDomain !== domain) {
    return {
      email: trimmed,
      isValid: true,
      confidence: 78,
      reason: 'typo_fixed',
      fixedEmail: `${localPart}@${fixedDomain}`,
      layer: 1,
    }
  }

  // 1C. Domaine jetable → invalide direct
  if (DISPOSABLE_DOMAINS.has(domain)) {
    return { email: trimmed, isValid: false, confidence: 0, reason: 'disposable', layer: 1 }
  }

  // 1D. Fournisseur connu → valide avec confiance élevée (pas besoin de MX)
  if (KNOWN_VALID_PROVIDERS.has(domain)) {
    const isRole = ROLE_PREFIXES.has(localPart.split(/[.\-_+]/)[0])
    return {
      email: trimmed,
      isValid: true,
      confidence: isRole ? 72 : 88,
      reason: isRole ? 'known_provider_role' : 'known_provider',
      layer: 1,
    }
  }

  // ── LAYER 2 : Checks gratuits avec requête réseau ──

  // 2A. MX record
  const hasMx = await checkMxRecord(domain)
  if (!hasMx) {
    return { email: trimmed, isValid: false, confidence: 5, reason: 'no_mx_record', layer: 2 }
  }

  // 2B. Role-based sur domaine business → confiance moyenne
  const isRole = ROLE_PREFIXES.has(localPart.split(/[.\-_+]/)[0])
  if (isRole) {
    // Role emails on business domains: valid but uncertain — use MillionVerifier
    const mvResult = await checkMillionVerifier(trimmed)
    if (mvResult) {
      return {
        email: trimmed,
        isValid: mvResult.valid,
        confidence: mvResult.confidence,
        reason: 'millionverifier_role',
        layer: 3,
      }
    }
    return { email: trimmed, isValid: true, confidence: 62, reason: 'mx_valid_role', layer: 2 }
  }

  // 2C. Domaine business avec MX valide — confiance bonne mais pas certaine
  // Heuristic: domaine avec TLD professionnel connu (.fr, .com, .net, .org)
  const professionalTlds = ['.fr','.com','.net','.org','.eu','.biz','.pro','.io']
  const hasProfessionalTld = professionalTlds.some(tld => domain.endsWith(tld))

  if (hasProfessionalTld) {
    // Confiance 75% — pas besoin de MillionVerifier sauf si score bas
    return {
      email: trimmed,
      isValid: true,
      confidence: 75,
      reason: 'mx_valid_business',
      layer: 2,
    }
  }

  // ── LAYER 3 : MillionVerifier pour les cas incertains ──
  const mvResult = await checkMillionVerifier(trimmed)
  if (mvResult) {
    return {
      email: trimmed,
      isValid: mvResult.valid,
      confidence: mvResult.confidence,
      reason: mvResult.valid ? 'millionverifier_ok' : 'millionverifier_invalid',
      layer: 3,
    }
  }

  // Fallback final
  return { email: trimmed, isValid: true, confidence: 60, reason: 'mx_valid', layer: 2 }
}

// ─── Batch validator avec stats ─────────────────────────────────────────────
export async function validateEmailBatch(emails: string[]): Promise<{
  results: EmailValidation[]
  stats: {
    total: number
    valid: number
    invalid: number
    layer1: number  // validés gratuitement instantanément
    layer2: number  // validés gratuitement via réseau
    layer3: number  // nécessité MillionVerifier
    savedCredits: number  // crédits MV économisés
  }
}> {
  const results: EmailValidation[] = []
  for (const email of emails) {
    results.push(await validateEmail(email))
  }

  const layer1 = results.filter(r => r.layer === 1).length
  const layer2 = results.filter(r => r.layer === 2).length
  const layer3 = results.filter(r => r.layer === 3).length

  return {
    results,
    stats: {
      total: emails.length,
      valid: results.filter(r => r.isValid).length,
      invalid: results.filter(r => !r.isValid).length,
      layer1,
      layer2,
      layer3,
      savedCredits: layer1 + layer2, // emails validés sans utiliser MV
    },
  }
}
