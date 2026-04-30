import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  const { prospectId, subject, body, type } = await request.json()

  await new Promise(res => setTimeout(res, 800))

  return NextResponse.json({
    success: true,
    messageId: `sim_${Date.now()}`,
    prospectId,
    type,
    sentAt: new Date().toISOString(),
    simulatedOpenAt: new Date(Date.now() + Math.random() * 4 * 3600_000).toISOString(),
    note: 'Simulation — aucun email réel envoyé',
  })
}
