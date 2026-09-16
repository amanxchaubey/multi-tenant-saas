const stripe = require('../../config/stripe');
const billingService = require('./billing.service');
const logger = require('../../config/logger');

async function createCheckout(req, res, next) {
  try {
    const url = await billingService.createCheckoutSession(req.orgId, req.orgSlug);
    res.json({ success: true, checkoutUrl: url });
  } catch (err) {
    next(err);
  }
}

/**
 * Stripe webhook endpoint. Verifies the request genuinely came from
 * Stripe using the signature header, then reacts to specific event
 * types. Everything else is ignored (Stripe sends many event types we
 * don't need to act on).
 */
async function handleWebhook(req, res) {
  if (!stripe) {
    return res.status(503).json({ success: false, message: 'Billing is not configured' });
  }

  const signature = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    logger.warn({ err: err.message }, 'Stripe webhook signature verification failed');
    return res.status(400).json({ success: false, message: 'Invalid webhook signature' });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const subscription = await stripe.subscriptions.retrieve(session.subscription);
        await billingService.applySubscriptionUpdate({
          organizationId: session.metadata.organizationId,
          subscriptionId: subscription.id,
          status: subscription.status,
          plan: 'pro',
        });
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        await billingService.applySubscriptionUpdate({
          organizationId: subscription.metadata.organizationId,
          subscriptionId: subscription.id,
          status: subscription.status,
          plan: subscription.status === 'active' ? 'pro' : 'free',
        });
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        await billingService.applySubscriptionUpdate({
          organizationId: subscription.metadata.organizationId,
          subscriptionId: subscription.id,
          status: 'canceled',
          plan: 'free',
        });
        break;
      }

      case 'invoice.payment_failed': {
        logger.warn({ eventId: event.id }, 'Stripe payment failed');
        break;
      }

      default:
        // Ignore every other event type — Stripe sends many we don't need.
        break;
    }
  } catch (err) {
    logger.error({ err: err.message, eventType: event.type }, 'Error processing Stripe webhook');
    // Still return 200 — Stripe will retry on non-2xx, and if OUR code
    // has a bug, endless retries won't fix it. Log it, investigate manually.
  }

  res.json({ received: true });
}

module.exports = { createCheckout, handleWebhook };