import { NextRequest, NextResponse } from 'next/server'
import { validateEmail } from '@/lib/scraper/email-validator'

// Column aliases — maps normalized CSV header to canonical field name
const COLUMN_ALIASES: Record<string, string> = {
  email: 'email',
  e_mail: 'email',
  'e-mail': 'email',
  name: 'name',
  nom: 'name',
  prenom: 'name',
  'prénom': 'name',
  'first name': 'name',
  firstname: 'name',
  company: 'company',
  entreprise: 'company',
  société: 'company',
  societe: 'company',
  'company name': 'company',
  phone: 'phone',
  telephone: 'phone',
  téléphone: 'phone',
  tel: 'phone',
  tél: 'phone',
  mobile: 'phone',
  city: 'city',
  ville: 'city',
  locality: 'city',
  sector: 'sector',
  secteur: 'sector',
  metier: 'sector',
  métier: 'sector',
  activity: 'sector',
  activite: 'sector',
  activité: 'sector',
  website: 'website',
  site: 'website',
  'site web': 'website',
  url: 'website',
  web: 'website',
}

type ParsedRow = {
  email?: string
  name?: string
  company?: string
  phone?: string
  city?: string
  sector?: string
  website?: string
}

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[^a-z0-9_\- éèêëàâùûüîï]/g, '').trim()
}

function parseCSV(csvText: string): { headers: string[]; rows: ParsedRow[] } {
  const lines = csvText.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return { headers: [], rows: [] }

  // Handle quoted fields
  function parseLine(line: string): string[] {
    const fields: string[] = []
    let current = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"'
          i++
        } else {
          inQuotes = !inQuotes
        }
      } else if (ch === ',' && !inQuotes) {
        fields.push(current.trim())
        current = ''
      } else if ((ch === ';') && !inQuotes) {
        // Also support semicolon delimiter
        fields.push(current.trim())
        current = ''
      } else {
        current += ch
      }
    }
    fields.push(current.trim())
    return fields
  }

  const rawHeaders = parseLine(lines[0])
  // Map raw headers to canonical names
  const canonicalHeaders = rawHeaders.map(h => {
    const norm = normalizeHeader(h)
    return COLUMN_ALIASES[norm] ?? norm
  })

  const rows: ParsedRow[] = []
  for (let i = 1; i < lines.length; i++) {
    const values = parseLine(lines[i])
    const row: ParsedRow = {}
    canonicalHeaders.forEach((header, idx) => {
      const value = values[idx]?.trim()
      if (!value) return
      if (header === 'email') row.email = value
      else if (header === 'name') row.name = value
      else if (header === 'company') row.company = value
      else if (header === 'phone') row.phone = value
      else if (header === 'city') row.city = value
      else if (header === 'sector') row.sector = value
      else if (header === 'website') row.website = value
    })
    if (row.email || row.company) rows.push(row)
  }

  return { headers: canonicalHeaders, rows }
}

export async function POST(request: NextRequest) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json(
      { error: 'DATABASE_URL not configured', inserted: 0, skipped: 0, invalid: 0 },
      { status: 200 },
    )
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const file = formData.get('file')
  const campaignId = formData.get('campaignId') as string | null

  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: 'Missing file field in form data' }, { status: 400 })
  }

  const csvText = await file.text()
  const { rows } = parseCSV(csvText)

  if (rows.length === 0) {
    return NextResponse.json({ error: 'CSV is empty or has no parseable rows', inserted: 0, skipped: 0, invalid: 0 }, { status: 400 })
  }

  const { db } = await import('@/lib/db')
  const { contacts, blocklist } = await import('@/lib/db/schema')
  const { eq, or } = await import('drizzle-orm')

  let inserted = 0
  let skipped = 0
  let invalid = 0

  for (const row of rows) {
    if (!row.email) {
      skipped++
      continue
    }

    // Validate email
    const validation = await validateEmail(row.email)
    if (!validation.isValid) {
      invalid++
      continue
    }

    const finalEmail = validation.fixedEmail ?? row.email.toLowerCase().trim()

    // Check blocklist
    const blocked = await db
      .select()
      .from(blocklist)
      .where(
        or(
          eq(blocklist.email, finalEmail),
          eq(blocklist.domain, finalEmail.split('@')[1]),
        ),
      )
      .limit(1)

    if (blocked.length > 0) {
      skipped++
      continue
    }

    // Check duplicate
    const existing = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(eq(contacts.email, finalEmail))
      .limit(1)

    if (existing.length > 0) {
      skipped++
      continue
    }

    try {
      await db.insert(contacts).values({
        email: finalEmail,
        name: row.name ?? null,
        company: row.company ?? finalEmail.split('@')[1],
        website: row.website ?? null,
        phone: row.phone ?? null,
        sector: row.sector ?? null,
        city: row.city ?? null,
        email_confidence_score: validation.confidence,
        email_validated: validation.confidence >= 70,
        source: 'csv_import',
      })
      inserted++
    } catch {
      skipped++
    }
  }

  void campaignId

  return NextResponse.json({
    total: rows.length,
    inserted,
    skipped,
    invalid,
  })
}
