import Stripe from "stripe"

export function billingConfig() {
  const key = process.env.STRIPE_SECRET_KEY || ""
  const origin = process.env.BILLING_APP_ORIGIN || ""
  // This release is deliberately test-only, including on Vercel previews.
  if (process.env.STRIPE_BILLING_ENABLED !== "true" || process.env.VERCEL_ENV === "production"
    || !/^(rk|sk)_test_/.test(key) || !process.env.STRIPE_ACCOUNT_ID
    || !process.env.STRIPE_BASE_PRICE_ID || !process.env.STRIPE_PROVIDER_PRICE_ID
    || !process.env.STRIPE_WEBHOOK_SECRET || !process.env.STRIPE_PORTAL_CONFIGURATION_ID) {
    throw new Error("Billing is not configured for testing")
  }
  const url = new URL(origin)
  if (url.origin !== origin || (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname))) {
    throw new Error("Invalid billing origin")
  }
  // Never grant production entitlements from a test transaction.
  if (process.env.NEXT_PUBLIC_SUPABASE_URL?.includes("lvtabzfkajgicjfexvxx")) {
    throw new Error("Test billing requires an isolated database")
  }
  return { key, origin, account: process.env.STRIPE_ACCOUNT_ID,
    base: process.env.STRIPE_BASE_PRICE_ID, provider: process.env.STRIPE_PROVIDER_PRICE_ID,
    webhook: process.env.STRIPE_WEBHOOK_SECRET, portal: process.env.STRIPE_PORTAL_CONFIGURATION_ID }
}

export async function billingStripe() {
  const config = billingConfig()
  const stripe = new Stripe(config.key, { maxNetworkRetries: 2, timeout: 10000 })
  const account = await stripe.accounts.retrieve(null)
  if (account.id !== config.account) throw new Error("Stripe account mismatch")
  const prices = await Promise.all([stripe.prices.retrieve(config.base), stripe.prices.retrieve(config.provider)])
  for (const [index, price] of prices.entries()) {
    if (price.livemode || !price.active || price.currency !== "usd" || price.type !== "recurring"
      || price.recurring?.interval !== "month" || price.recurring.interval_count !== 1
      || price.recurring.usage_type !== "licensed" || price.billing_scheme !== "per_unit"
      || price.unit_amount !== (index === 0 ? 7900 : 2900) || price.transform_quantity) {
      throw new Error("Stripe price does not match launch terms")
    }
  }
  return { stripe, config }
}
