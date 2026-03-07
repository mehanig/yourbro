CREATE TABLE IF NOT EXISTS page_views (
    id         BIGSERIAL PRIMARY KEY,
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    slug       TEXT NOT NULL,
    ip_hash    TEXT NOT NULL,
    referrer   TEXT NOT NULL DEFAULT '',
    is_bot     BOOLEAN NOT NULL DEFAULT FALSE,
    viewed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_page_views_user_slug ON page_views (user_id, slug, viewed_at);
CREATE INDEX idx_page_views_user_viewed ON page_views (user_id, viewed_at);
