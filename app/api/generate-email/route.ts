import { NextRequest, NextResponse } from 'next/server'
import { generateEmail } from '@/lib/email-generator'
import { Prospect } from '@/types'

export async function POST(request: NextRequest) {
  try {
    const { prospect, type } = await request.json() as {
      prospect: Prospect
      type: 'initial' | 'followup_1' | 'followup_2' | 'followup_3'
    }

    if (!prospect || !type) {
      return NextResponse.json({ error: 'prospect and type required' }, { status: 400 })
    }

    const result = await generateEmail(prospect, type)
    return NextResponse.json(result)
  } catch (error) {
    console.error('Email generation error:', error)
    return NextResponse.json({ error: 'Generation failed' }, { status: 500 })
  }
}
