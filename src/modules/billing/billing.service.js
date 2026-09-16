const stripe = require('../../config/stripe');
const { query } = require('../../config/db');
const AppError = require('../../lib/AppError');

async function createCheckoutSession(orgId, orgSlug) {
  if (!stripe) throw new AppError('Billing is not configured on this server', 503);

  const { rows } = await query('SELECT * FROM organizations WHERE id = $1', [orgId]);
  const org = rows[0];
  if (!org) throw new AppError('Organization not found', 404);

  // Reuse an existing Stripe customer if we already created one for this
  // org, otherwise create a fresh one and remember it.
  let customerId = org.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({
      name: org.name,
      metadata: { organizationId: org.id },
    });
    customerId = customer.id;
    await query('UPDATE organizations SET stripe_customer_id = $1 WHERE id = $2', [customerId, org.id]);
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: process.env.STRIPE_PRICE_ID_PRO, quantity: 1 }],
    success_url: `${process.env.FRONTEND_BILLING_SUCCESS_URL}?org=${orgSlug}`,
    cancel_url: `${process.env.FRONTEND_BILLING_CANCEL_URL}?org=${orgSlug}`,
    metadata: { organizationId: org.id },
  });

  return session.url;
}

/**
 * Called from the webhook handler, never directly from a client request.
 * Idempotent by design: applying the same event twice just re-sets the
 * same values, causing no harm — important because Stripe can and does
 * redeliver webhook events.
 */
async function applySubscriptionUpdate({ organizationId, subscriptionId, status, plan }) {
  await query(
    `UPDATE organizations
     SET stripe_subscription_id = $1, subscription_status = $2, plan = $3
     WHERE id = $4`,
    [subscriptionId, status, plan, organizationId],
  );
}

module.exports = { createCheckoutSession, applySubscriptionUpdate };