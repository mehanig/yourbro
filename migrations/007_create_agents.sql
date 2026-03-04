CREATE TABLE IF NOT EXISTS agents (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id),
    name TEXT NOT NULL DEFAULT '',
    endpoint TEXT NOT NULL,
    last_heartbeat TIMESTAMPTZ,
    paired_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agents_user_id ON agents(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_user_endpoint ON agents(user_id, endpoint);
