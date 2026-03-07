-- Add UUID column to agents table. Backfill existing agents with random UUIDs.
ALTER TABLE agents ADD COLUMN IF NOT EXISTS uuid TEXT;
UPDATE agents SET uuid = gen_random_uuid()::text WHERE uuid IS NULL;
ALTER TABLE agents ALTER COLUMN uuid SET NOT NULL;
ALTER TABLE agents ALTER COLUMN uuid SET DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_uuid ON agents(uuid);
