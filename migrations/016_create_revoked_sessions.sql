CREATE TABLE revoked_sessions (
    token_hash TEXT PRIMARY KEY,
    revoked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_revoked_sessions_expires ON revoked_sessions(expires_at);
