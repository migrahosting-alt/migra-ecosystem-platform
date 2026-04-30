-- MigraBuilder Database Schema
-- Run once against your PostgreSQL instance:
--   psql $DATABASE_URL -f schema.sql

CREATE TABLE IF NOT EXISTS mb_sites (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   TEXT        NOT NULL,
  name       TEXT        NOT NULL,
  domain     TEXT,
  status     TEXT        NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS mb_sites_owner_id ON mb_sites(owner_id);

CREATE TABLE IF NOT EXISTS mb_pages (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id       UUID        NOT NULL REFERENCES mb_sites(id) ON DELETE CASCADE,
  title         TEXT        NOT NULL DEFAULT 'Untitled Page',
  slug          TEXT        NOT NULL DEFAULT '',
  doc_json      JSONB,
  published_html TEXT,
  status        TEXT        NOT NULL DEFAULT 'draft',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS mb_pages_site_id ON mb_pages(site_id);

CREATE TABLE IF NOT EXISTS mb_theme_presets (
  id         TEXT        PRIMARY KEY,
  site_id    UUID        REFERENCES mb_sites(id) ON DELETE CASCADE,
  user_id    TEXT,
  scope      TEXT        NOT NULL DEFAULT 'user',
  name       TEXT        NOT NULL,
  theme_json JSONB       NOT NULL,
  pinned     BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS mb_theme_presets_user_id ON mb_theme_presets(user_id);
CREATE INDEX IF NOT EXISTS mb_theme_presets_scope   ON mb_theme_presets(scope);

CREATE TABLE IF NOT EXISTS mb_shared_presets (
  id         TEXT        PRIMARY KEY,
  share_id   TEXT        UNIQUE NOT NULL,
  preset_json JSONB      NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Site branding per-site (logo URL, icon URL)
CREATE TABLE IF NOT EXISTS mb_site_branding (
  site_id        UUID    PRIMARY KEY REFERENCES mb_sites(id) ON DELETE CASCADE,
  logo_url       TEXT,
  icon_url       TEXT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
