ALTER TABLE organizations ADD COLUMN stripe_customer_id TEXT;
ALTER TABLE organizations ADD COLUMN stripe_subscription_id TEXT;
ALTER TABLE organizations ADD COLUMN subscription_status TEXT NOT NULL DEFAULT 'inactive';