-- Additive discussion-thread and aggregate analytics foundation.
-- Existing social_posts rows and constraints are preserved.
CREATE TABLE IF NOT EXISTS social_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform VARCHAR(40) NOT NULL,
  external_id VARCHAR(240) NOT NULL,
  root_post_id UUID REFERENCES social_posts(id) ON DELETE SET NULL,
  parent_external_id VARCHAR(240),
  parent_thread_id UUID REFERENCES social_threads(id) ON DELETE SET NULL,
  thread_depth INTEGER NOT NULL DEFAULT 1 CHECK (thread_depth BETWEEN 1 AND 100),
  post_url TEXT,
  author_handle VARCHAR(160),
  content TEXT NOT NULL,
  published_at TIMESTAMPTZ,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (platform, external_id)
);
CREATE INDEX IF NOT EXISTS social_threads_root_published_idx ON social_threads (root_post_id, published_at DESC);
CREATE INDEX IF NOT EXISTS social_threads_parent_idx ON social_threads (platform, parent_external_id);
CREATE INDEX IF NOT EXISTS social_threads_published_idx ON social_threads (published_at DESC);

CREATE TABLE IF NOT EXISTS discovered_hashtags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform VARCHAR(40) NOT NULL,
  hashtag VARCHAR(160) NOT NULL,
  normalized_hashtag VARCHAR(160) NOT NULL,
  source_post_id UUID REFERENCES social_posts(id) ON DELETE CASCADE,
  source_thread_id UUID REFERENCES social_threads(id) ON DELETE CASCADE,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  occurrence_count INTEGER NOT NULL DEFAULT 1 CHECK (occurrence_count > 0),
  UNIQUE (platform, normalized_hashtag, source_post_id, source_thread_id)
);
CREATE INDEX IF NOT EXISTS discovered_hashtags_normalized_idx ON discovered_hashtags (normalized_hashtag, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS post_keywords (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_post_id UUID REFERENCES social_posts(id) ON DELETE CASCADE,
  source_thread_id UUID REFERENCES social_threads(id) ON DELETE CASCADE,
  platform VARCHAR(40) NOT NULL,
  keyword VARCHAR(160) NOT NULL,
  normalized_keyword VARCHAR(160) NOT NULL,
  term_type VARCHAR(24) NOT NULL DEFAULT 'word' CHECK (term_type IN ('word','phrase','hashtag','entity_candidate')),
  occurrences INTEGER NOT NULL DEFAULT 1 CHECK (occurrences > 0),
  extracted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((source_post_id IS NOT NULL) <> (source_thread_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS post_keywords_post_term_idx ON post_keywords (source_post_id, normalized_keyword, term_type) WHERE source_post_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS post_keywords_thread_term_idx ON post_keywords (source_thread_id, normalized_keyword, term_type) WHERE source_thread_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS post_keywords_term_idx ON post_keywords (normalized_keyword, extracted_at DESC);

CREATE TABLE IF NOT EXISTS collection_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform VARCHAR(40) NOT NULL,
  collection_type VARCHAR(32) NOT NULL CHECK (collection_type IN ('search','thread','replies','hashtags','rss','open_data')),
  query_label VARCHAR(240),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  status VARCHAR(20) NOT NULL DEFAULT 'running' CHECK (status IN ('running','succeeded','partial','failed','rate_limited')),
  posts_seen INTEGER NOT NULL DEFAULT 0,
  replies_seen INTEGER NOT NULL DEFAULT 0,
  errors_count INTEGER NOT NULL DEFAULT 0,
  error_class VARCHAR(80),
  coverage_note TEXT
);
CREATE INDEX IF NOT EXISTS collection_runs_platform_started_idx ON collection_runs (platform, started_at DESC);

CREATE TABLE IF NOT EXISTS analytics_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_type VARCHAR(32) NOT NULL CHECK (report_type IN ('trend','sentiment','issue_map','stakeholder_aggregate','swot','pestle','risk','evidence_review')),
  title VARCHAR(240) NOT NULL,
  scope JSONB NOT NULL DEFAULT '{}'::jsonb,
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,
  methodology JSONB NOT NULL DEFAULT '{}'::jsonb,
  findings JSONB NOT NULL DEFAULT '{}'::jsonb,
  limitations TEXT NOT NULL DEFAULT '',
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS analytics_reports_type_generated_idx ON analytics_reports (report_type, generated_at DESC);
