import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 503 })
  }

  const { stripe } = await import('@/lib/stripe')
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

  if (!webhookSecret) {
    return NextResponse.json({ error: 'STRIPE_WEBHOOK_SECRET not configured' }, { status: 503 })
  }

  const body = await request.text()
  const sig = request.headers.get('stripe-signature')

  if (!sig) {
    return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 })
  }

  let event
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret)
  } catch (err) {
    console.error('[stripe/webhook] Signature verification failed:', err)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  console.log('[stripe/webhook] Event:', event.type)

  // Handle SetupIntent succeeded — save the payment method ID
  if (event.type === 'setup_intent.succeeded') {
    const setupIntent = event.data.object
    const paymentMethodId = setupIntent.payment_method

    if (paymentMethodId && typeof paymentMethodId === 'string' && process.env.DATABASE_URL) {
      const { db } = await import('@/lib/db')
      const { agent_config } = await import('@/lib/db/schema')

      await db
        .insert(agent_config)
        .values({ key: 'stripe_payment_method_id', value: paymentMethodId, updated_by: 'stripe_webhook' })
        .onConflictDoUpdate({
          target: agent_config.key,
          set: { value: paymentMethodId, updated_at: new Date() },
        })

      // Attach payment method to customer if needed
      try {
        const { stripe: stripeClient } = await import('@/lib/stripe')
        const [customerRow] = await db
          .select()
          .from(agent_config)
          .where((await import('drizzle-orm')).eq(agent_config.key, 'stripe_customer_id'))

        if (customerRow?.value) {
          await stripeClient.paymentMethods.attach(paymentMethodId, { customer: customerRow.value })
          await stripeClient.customers.update(customerRow.value, {
            invoice_settings: { default_payment_method: paymentMethodId },
          })
        }
      } catch (attachErr) {
        console.error('[stripe/webhook] Failed to attach payment method:', attachErr)
      }

      console.log('[stripe/webhook] Saved payment method:', paymentMethodId)
    }
  }

  if (event.type === 'payment_intent.succeeded') {
    const pi = event.data.object
    console.log('[stripe/webhook] Payment succeeded:', pi.id, 'amount:', pi.amount, 'metadata:', pi.metadata)
  }

  if (event.type === 'payment_intent.payment_failed') {
    const pi = event.data.object
    console.error('[stripe/webhook] Payment failed:', pi.id, pi.last_payment_error?.message)
  }

  return NextResponse.json({ received: true })
}
