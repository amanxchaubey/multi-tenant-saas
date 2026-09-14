CREATE TABLE refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL,
  revoked_at TIMESTAMP,
  replaced_by_id UUID REFERENCES refresh_tokens(id)
);

CREATE INDEX idx_refresh_tokens_hash ON refresh_tokens(token_hash);

-- Not RLS-protected, same reasoning as `users`: this table is looked up
-- by a hashed token value before any tenant context can be established,
-- and access is inherently scoped by knowledge of the (unguessable)
-- raw token itself, not by organization_id filtering.