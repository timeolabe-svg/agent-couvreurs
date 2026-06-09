import { NextRequest, NextResponse } from 'next/server'

// POST — creates Stripe Customer + SetupIntent for saving a card
// Returns { clientSecret, customerId }
//
// GET — returns current payment method info if card is saved
// Returns { last4, brand, exp_month, exp_year } | null

export async function POST() {
  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: 'STRIPE_SECRET_KEY not configured' }, { status: 503 })
  }
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'DATABASE_URL not configured' }, { status: 503 })
  }

  const { stripe } = await import('@/lib/stripe')
  const { db } = await import('@/lib/db')
  const { agent_config } = await import('@/lib/db/schema')
  const { eq } = await import('drizzle-orm')

  // Get or create Stripe customer
  const [existingCustomerRow] = await db
    .select()
    .from(agent_config)
    .where(eq(agent_config.key, 'stripe_customer_id'))

  let customerId = existingCustomerRow?.value

  if (!customerId) {
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

  // Create SetupIntent
  const setupIntent = await stripe.setupIntents.create({
    customer: customerId,
    payment_method_types: ['card'],
  })

  return NextResponse.json({
    clientSecret: setupIntent.client_secret,
    customerId,
  })
}

export async function GET(_request: NextRequest) {
  if (!process.env.STRIPE_SECRET_KEY || !process.env.DATABASE_URL) {
    return NextResponse.json(null)
  }

  const { stripe } = await import('@/lib/stripe')
  const { db } = await import('@/lib/db')
  const { agent_config } = await import('@/lib/db/schema')
  const { eq } = await import('drizzle-orm')

  const [customerRow] = await db
    .select()
    .from(agent_config)
    .where(eq(agent_config.key, 'stripe_customer_id'))

  if (!customerRow?.value) {
    return NextResponse.json(null)
  }

  const [pmRow] = await db
    .select()
    .from(agent_config)
    .where(eq(agent_config.key, 'stripe_payment_method_id'))

  if (!pmRow?.value) {
    return NextResponse.json(null)
  }

  try {
    const pm = await stripe.paymentMethods.retrieve(pmRow.value)
    if (pm.card) {
      return NextResponse.json({
        last4: pm.card.last4,
        brand: pm.card.brand,
        exp_month: pm.card.exp_month,
        exp_year: pm.card.exp_year,
      })
    }
  } catch {
    // Payment method might no longer exist
  }

  return NextResponse.json(null)
}
