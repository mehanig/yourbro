-- Allow agents to connect via WebSocket relay (no public endpoint needed)
ALTER TABLE agents ALTER COLUMN endpoint DROP NOT NULL;

-- Old unique index breaks with NULL endpoints (NULL ≠ NULL in SQL).
-- Replace with partial index that only enforces uniqueness for direct-mode agents.
DROP INDEX IF EXISTS idx_agents_user_endpoint;
CREATE UNIQUE INDEX idx_agents_user_endpoint ON agents(user_id, endpoint) WHERE endpoint IS NOT NULL;
