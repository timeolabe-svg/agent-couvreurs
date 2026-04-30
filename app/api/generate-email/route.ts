import { NextRequest, NextResponse } from 'next/server'
import { generateEmail } from '@/lib/email-generator'
import { Lead } from '@/types'

export async function POST(request: NextRequest) {
  try {
    const { lead, type } = await request.json() as {
      lead: Lead
      type: 'initial' | 'followup_1' | 'followup_2' | 'followup_3'
    }
    if (!lead || !type) return NextResponse.json({ error: 'lead and type required' }, { status: 400 })
    const result = await generateEmail(lead, type)
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json({ error: 'Generation failed' }, { status: 500 })
  }
}
