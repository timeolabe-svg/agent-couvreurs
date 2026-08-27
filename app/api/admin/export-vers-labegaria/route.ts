import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'
import { wrapCron } from '@/lib/cron-wrap'

/**
 * Concurrents directs de Timéo : agences web / com / marketing / prospection. Ils ne doivent être
 * démarchés par AUCUN de ses agents.
 * ⚠️ Défini ICI et pas importé : `isConcurrentAgence` existe côté labegaria, pas côté Hdigiweb —
 * les deux projets ont des bibliothèques distinctes malgré des noms de fichiers identiques. Croire
 * qu'une fonction est disponible parce qu'elle existe « dans l'autre projet » est une erreur que
 * j'ai déjà faite aujourd'hui (le schéma contacts n'a pas les mêmes colonnes non plus).
 */
function estConcurrent(texte: string): boolean {
  const t = (texte || '').toLowerCase()
  if (/\b(agence|studio|agency)\b[^.]{0,30}\b(com|communication|marketing|pub|publicit[ée]|digital|digitale|cr[ée]a|web|seo|sea|r[ée]f[ée]rencement|growth|social|design|prospection|commerciale?)\b/.test(t)) return true
  if (/\b(web\s?agency|webdesign|web\s?design|cr[ée]ation\s+de\s+sites?|refonte\s+de\s+sites?|d[ée]veloppement\s+web|freelance\s+web|community\s+manager|prospection\s+commerciale|g[ée]n[ée]ration\s+de\s+leads?)\b/.test(t)) return true
  return false
}

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * EXPORT DES LEADS QUE HDIGIWEB NE PEUT PAS EXPLOITER, VERS LABEGARIA.
 *
 * Hdigiweb n'écrit qu'aux entreprises ayant au moins 20 avis Google (critère client). Les autres
 * sont conservées en base sans jamais être contactées. Elles restent pourtant de très bonnes
 * cibles pour LabegarIA — souvent des structures plus récentes, qui ont justement le plus besoin
 * de visibilité.
 *
 * ⚠️ RÈGLE RGPD ABSOLUE, ET C'EST ELLE QUI DICTE LE PÉRIMÈTRE.
 * L'opposition suit la PERSONNE, pas la campagne : transférer à une autre marque quelqu'un qui
 * s'est opposé serait un manquement — c'est le motif exact de la plainte du 06/08.
 * On n'exporte donc QUE des fiches JAMAIS CONTACTÉES par Hdigiweb (statut 'skipped_lowreviews' :
 * écartées AVANT le moindre envoi). Une fiche jamais démarchée ne peut pas porter d'opposition.
 * Par précaution on croise quand même avec la blocklist, sur l'email ET le téléphone.
 *
 * Les concurrents (agences web / com / prospection) sont retirés ici aussi : ce sont les
 * concurrents directs de Timéo, ils ne doivent être démarchés par AUCUN de ses agents.
 *
 * On exporte `website` MÊME VIDE : c'est lui qui décide de l'offre côté labegaria (site correct →
 * Agent IA, site absent ou faible → Site internet). Ne pas filtrer là-dessus.
 *
 * GET            → aperçu chiffré
 * GET ?csv=1     → le fichier CSV
 */
async function handler(req: NextRequest) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { sql } = await import('@/lib/db')

  const brut = (await sql`
    -- ⚠️ PAS de colonne sector dans outscraper_leads côté Hdigiweb (elle existe côté labegaria).
    -- Troisième confusion de schéma entre les deux projets aujourd hui : leurs tables portent les
    -- mêmes NOMS mais pas les mêmes COLONNES. Ne jamais écrire une requête de mémoire.
    SELECT ol.name AS company, ol.site AS website, ol.phone, ol.city, ol.postal_code,
           ol.email, ol.reviews, ol.rating
    FROM outscraper_leads ol
    WHERE ol.status = 'skipped_lowreviews'
      -- Jamais contactée : aucune trace d'envoi, donc aucune opposition possible.
      AND NOT EXISTS (
        SELECT 1 FROM contacts c
        WHERE (ol.email IS NOT NULL AND LOWER(c.email) = LOWER(ol.email))
      )
      -- Ceinture et bretelles : jamais une adresse ou un numéro déjà bloqué.
      AND NOT EXISTS (
        SELECT 1 FROM blocklist b
        WHERE (ol.email IS NOT NULL AND LOWER(b.email) = LOWER(ol.email))
      )
    /**
     * ⚠️ LES FICHES DÉJÀ EN BASE SOUS 20 AVIS PARTENT AUSSI (consigne Timéo, 27/08).
     *
     * Cet export ne prenait que les leads REJETÉS À L'IMPORT (outscraper_leads). Or il y a aussi,
     * dans contacts, des entreprises importées avant que le seuil existe : mesuré le 27/08,
     * **326 d'entre elles ont des mails en file qui ne partiront JAMAIS**, puisque le moteur exige
     * 20 avis au moment d'envoyer. Elles dormaient donc en stock, ni démarchées ni transmises.
     *
     * Timéo tranche : sous 20 avis, ça va à LabegarIA, et à LabegarIA seulement. On les ajoute donc
     * ici, avec exactement les mêmes garde-fous — jamais quelqu'un qui a répondu, jamais quelqu'un
     * de bloqué, jamais quelqu'un qu'on a déjà démarché.
     */
    UNION ALL
    SELECT c.company, c.website, c.phone, c.city, c.postal_code,
           c.email, c.google_reviews_count AS reviews, c.google_rating AS rating
    FROM contacts c
    WHERE c.email IS NOT NULL
      AND COALESCE(c.google_reviews_count, 0) < 20
      AND NOT EXISTS (SELECT 1 FROM email_queue q WHERE q.contact_id = c.id AND q.status = 'sent')
      AND NOT EXISTS (SELECT 1 FROM incoming_replies ir WHERE ir.contact_id = c.id)
      AND NOT EXISTS (
        SELECT 1 FROM blocklist b
        WHERE (b.email IS NOT NULL AND LOWER(b.email) = LOWER(c.email))
           OR (b.domain IS NOT NULL AND b.domain <> '' AND LOWER(c.email) LIKE '%@' || LOWER(b.domain))
      )
    ORDER BY reviews DESC NULLS LAST
  `) as Array<{
    company: string; website: string | null; phone: string | null; city: string | null
    postal_code: string | null; email: string | null; reviews: number | null; rating: number | null
  }>

  // Concurrents : retirés côté source, pour ne pas dépendre du filtrage de l'autre projet.
  const concurrents: string[] = []
  const leads = brut.filter(l => {
    if (estConcurrent(l.company)) { concurrents.push(l.company); return false }
    return true
  })

  if (req.nextUrl.searchParams.get('csv') !== '1') {
    return NextResponse.json({
      ok: true,
      total_ecartes_par_hdigiweb: brut.length + concurrents.length,
      concurrents_retires: concurrents.length,
      exportables: leads.length,
      avec_site: leads.filter(l => l.website && l.website.trim()).length,
      sans_site: leads.filter(l => !l.website || !l.website.trim()).length,
      avec_email_deja_connu: leads.filter(l => l.email).length,
      note: 'website est exporté même vide : c\'est lui qui décide de l\'offre côté labegaria.',
      apercu: leads.slice(0, 5),
    })
  }

  // CSV — colonnes demandées par la session labegaria, dans cet ordre.
  const echap = (v: unknown) => {
    const s = String(v ?? '').replace(/"/g, '""')
    return /[",;\n]/.test(s) ? `"${s}"` : s
  }
  const lignes = [
    'email,company,website,phone,city,sector',
    ...leads.map(l => [l.email, l.company, l.website, l.phone, l.city, ""].map(echap).join(',')),
  ]
  return new NextResponse(lignes.join('\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="leads-hdigiweb-vers-labegaria.csv"',
    },
  })
}

/** Enveloppe d erreur : un 500 muet ne dit rien, et j en ai deja perdu du temps aujourd hui. */
export const GET = wrapCron('export-vers-labegaria', handler)
