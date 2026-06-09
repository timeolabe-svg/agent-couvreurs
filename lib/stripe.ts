// Required env vars (add to Vercel):
// STRIPE_SECRET_KEY=sk_live_...
// STRIPE_PUBLISHABLE_KEY=pk_live_...
// STRIPE_WEBHOOK_SECRET=whsec_...

import Stripe from 'stripe'

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? '', {
  apiVersion: '2026-05-27.dahlia',
})
