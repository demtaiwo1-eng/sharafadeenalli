CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(240) NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  topic VARCHAR(80) NOT NULL DEFAULT 'General',
  published_at TIMESTAMPTZ NOT NULL,
  source_name VARCHAR(160) NOT NULL DEFAULT 'Unknown',
  source_url TEXT NOT NULL UNIQUE,
  verification_status VARCHAR(24) NOT NULL DEFAULT 'unreviewed'
    CHECK (verification_status IN ('unreviewed','reported','corroborated','verified','corrected')),
  status VARCHAR(16) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','published','archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS public_updates_published_at_idx ON public_updates (published_at DESC) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS public_updates_topic_published_idx ON public_updates (topic, published_at DESC) WHERE status = 'published';

CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(180) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status VARCHAR(16) NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','active','blocked','completed','archived')),
  visibility VARCHAR(12) NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('public','private')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS projects_public_updated_idx ON projects (updated_at DESC) WHERE visibility = 'public';

-- Field submissions are intentionally not accepted by an unauthenticated public endpoint.
-- Add authenticated user/role tables and a reviewed submission workflow before enabling sync.
