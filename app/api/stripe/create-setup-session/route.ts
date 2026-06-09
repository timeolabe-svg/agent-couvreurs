import { NextResponse } from 'next/server'

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://hdigiweb.fr'

// POST — creates a Stripe Checkout Session in setup mode (no charge, just save card)
// Returns { url: string } — redirect to this URL
export async function POST() {
  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: 'STRIPE_SECRET_KEY not configured' }, { status: 503 })
  }

  const { stripe } = await import('@/lib/stripe')

  // Get or create customer
  let customerId: string | undefined

  if (process.env.DATABASE_URL) {
    const { db } = await import('@/lib/db')
    const { agent_config } = await import('@/lib/db/schema')
    const { eq } = await import('drizzle-orm')

    const [row] = await db.select().from(agent_config).where(eq(agent_config.key, 'stripe_customer_id'))
    if (row?.value) {
      customerId = row.value
    } else {
      const customer = await stripe.customers.create({
        description: 'Hdigiweb — Agent Couvreurs',
        metadata: { app: 'agent-couvreurs' },
      })
      customerId = customer.id
      await db
        .insert(agent_config)
        .values({ key: 'stripe_customer_id', value: customerId, updated_by: 'stripe_setup' })
        .onConflictDoUpdate({
          target: agent_config.key,
          set: { value: customerId, updated_at: new Date() },
        })
    }
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'setup',
    currency: 'eur',
    ...(customerId ? { customer: customerId } : {}),
    success_url: `${BASE_URL}/parametres?tab=facturation&stripe=success`,
    cancel_url: `${BASE_URL}/parametres?tab=facturation`,
    payment_method_types: ['card'],
  })

  return NextResponse.json({ url: session.url })
}
