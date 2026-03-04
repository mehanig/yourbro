-- Public keys for agent authentication (like SSH keys)
CREATE TABLE IF NOT EXISTS public_keys (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    public_key TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_public_keys_user_id ON public_keys(user_id);

-- Add agent endpoint to pages
ALTER TABLE pages ADD COLUMN IF NOT EXISTS agent_endpoint TEXT DEFAULT NULL;

-- Drop server-side storage
DROP TABLE IF EXISTS storage;
