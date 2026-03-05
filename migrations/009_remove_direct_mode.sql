-- Remove direct-mode columns from agents table.
-- Relay mode is now the only connection method.
ALTER TABLE agents DROP COLUMN IF EXISTS endpoint;
ALTER TABLE agents DROP COLUMN IF EXISTS last_heartbeat;

-- Drop the partial unique index on (user_id, endpoint) since endpoint is gone.
DROP INDEX IF EXISTS idx_agents_user_endpoint;

-- Add unique index on (user_id, name) to prevent duplicate agent names per user.
CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_user_name ON agents(user_id, name);
