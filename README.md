# CampTech Oyo — backend API

This repository now contains an initial Node.js/PostgreSQL API foundation. It is source code, not a deployed or production-hardened service yet.

## Included
- Express API with Helmet security headers, CORS allow-list support and request rate limiting.
- PostgreSQL connection pool and initial schema migration.
- Public, published-update listing and keyword search.
- Aggregate topic/source monitoring summary.
- Publicly visible project listing.
- Token-protected admin ingestion endpoint for sourced public updates; new records default to drafts, and publication requires a corroborated or verified status.
- Dockerfile and environment template.

## API routes
- `GET /health` — API/database readiness.
- `GET /v1/public/updates?limit=30&q=term` — published records, source links and verification labels.
- `GET /v1/monitoring/summary?from=ISO_DATE&to=ISO_DATE` — aggregate source/topic counts.
- `GET /v1/monitoring/scope` — the active Oyo State public-discourse scope, anchored on Sarafadeen Alli, with geographic coverage, issue areas and analysis guardrails.
- `GET /v1/integrations/catalog` — supported platform/provider catalogue, capabilities, access notes and whether required environment variables are configured.
- `GET /v1/admin/integrations/status` — authenticated integration configuration status; never returns secret values.
- `GET /v1/operations/projects` — public projects only.
- `POST /v1/admin/updates` — protected ingestion endpoint; requires `Authorization: Bearer <ADMIN_API_TOKEN>`.

## Active monitoring scope\n\nThe initial geographic scope is **Oyo State, Nigeria**, with Sarafadeen Alli as the named discovery/context anchor. Coverage includes Ibadan, Ogbomosho, Oyo, Ibarapa, Oke-Ogun and the Oyo Central, Oyo North and Oyo South senatorial districts. Federal and national developments are included only when materially relevant to Oyo. Issue areas include governance, public services, infrastructure, education, health, agriculture, jobs, security, environment, budgets, legislation and constituency issues.\n\nCollection is designed to include public posts, replies and nested replies where platform access permits, discover hashtags, and extract words and phrases. Geographic relevance must be evidenced; a mention of the anchor alone does not prove Oyo relevance. English, Yoruba and Nigerian Pidgin are in scope. Analysis is aggregate and evidence-led; individual political profiling, voter-preference inference and individual-targeted political persuasion are excluded.\n\n## Platform API integration catalogue

The API exposes a catalogue of 29 source/provider entries: X, Bluesky, Reddit, YouTube, Facebook, Instagram, Threads, TikTok, LinkedIn, Mastodon, Telegram, Discord, Pinterest, Snapchat, Twitch, Rumble, Truth Social, Gab, GETTR, Kwai, Kick, Tumblr, Hacker News, Substack, Medium, public news/RSS feeds, government/election open data, and optional unified providers (Desearch, TagX ListenX and Social Fetch).

Configure credentials only in the Render service's secret environment settings (or another server-side secret manager). Never put API keys in the GitHub Pages frontend, browser local storage, source control, or public API responses. The catalogue's `configured` flag only checks whether required environment variables exist; it does not validate a token, confirm platform approval, or guarantee a data entitlement.

See `src/integrations/catalog.js` for each connector's environment variable names, supported collection capabilities, access requirements and official/provider documentation links. Platform APIs differ: some expose public search and nested replies, while others only expose content from authorised accounts, approved research projects, or managed Pages. Collection must stay within each provider's permissions, terms, quotas and retention rules. A connector should be marked connected only after an authenticated health/test request succeeds.

The website now includes an API Connections picker where an administrator can select any catalogue entry and review its access requirements. The selected-source preference is currently stored in that browser only; it is not yet persisted as a server collection policy. The backend still needs the per-platform OAuth handshakes, live token validation, collection adapters, scheduled ingestion, reply-tree storage and analysis pipeline before a selected platform starts supplying records.

## Deploy and configure
1. Provision a managed PostgreSQL database (Neon is suitable for an initial managed database).
2. Deploy this repository as a Node 20 web service or Docker service on a host that supports persistent server processes.
3. Set environment variables from `.env.example` in the host's secret/configuration panel. Never commit actual secrets.
4. Set `CORS_ORIGIN` to the exact website origin, for example `https://demtaiwo1-eng.github.io` (origin only; no path). Cross-origin requests are denied when no allowed origins are configured.
5. Set a long random `ADMIN_API_TOKEN` in the host secret store. Ingestion records default to `draft`; set `status: "published"` only with `verificationStatus: "corroborated"` or `"verified"`.
6. Run `npm install`, then `npm run migrate`, then `npm start`.
7. Confirm `/health` returns `200` and `database: connected`.
8. Set `API_BASE_URL` in the website repository's `config.js` to the deployed API origin.

## Database migration
`npm run migrate` applies `migrations/001_initial.sql`. It creates public update and project tables with indexes. No production data is seeded.

## Important limitations before public launch
- Field reports currently save as drafts in the submitting browser only. They are not uploaded or shared. A proper authenticated submission workflow, roles, moderation and audit log must be added before enabling server-side field submissions.
- Admin token ingestion is a bootstrap mechanism, not a complete staff identity system. Replace it with managed authentication, roles, rotation and audit records before multiple staff use it.
- The included in-process rate limiter is per API instance. Use a shared edge/WAF or distributed limiter for multi-instance production.
- Add queue-backed source collection, observability, backups/PITR, automated tests, security review and load testing before production scale.
- No one-million-concurrent-user capacity claim is made. That requires an explicit traffic model, CDN, autoscaling, pooled database access and measured load tests.

## Data integrity and safety
Use public and authorised sources only. Preserve the original source URL and date. Clearly distinguish reported, corroborated and verified information. Do not profile individuals' political opinions, infer voter preferences, or target political persuasion to individuals. Do not place personal secrets in source control.


### Aggregate public-discourse analytics

- `GET /v1/monitoring/analytics?type=issue_map&days=30` — descriptive issue map.
- Supported report types: `trend`, `sentiment`, `issue_map`, `swot`, `pestle`, `risk`, and `evidence_review`.
- `days` is clamped to 1–180; analysis is limited to the latest 5,000 collected records.
- `POST /v1/admin/analytics/reports` with an authenticated JSON body such as `{"type":"swot","days":30}` saves a report to `analytics_reports`.
- Geography is labelled `oyo_named` only when a whole Oyo place name is present in the post text; otherwise it remains `oyo_unconfirmed`.
- Sentiment values are transparent positive/negative word indicators, not validated sentiment, endorsement, polling, or voter-preference estimates.
- SWOT and PESTLE outputs are structured review prompts. Frequency alone is not evidence that a programme succeeded, failed, or caused an outcome.
- Public posts and replies are treated as leads for human verification. Coverage is limited by available public APIs and collected records.



### Configured public-source collection adapters

The API has optional, permission-scoped collectors for:
- GDELT DOC 2.0 public news search (free, no API key; rolling seven-day query, up to 75 article metadata records, no comments/replies).
- Bluesky public search and available public reply threads.
- X recent search when an eligible bearer token is configured.
- Reddit OAuth search and provider-returned nested comment trees.
- YouTube Data API video search and available top-level/reply comments.
- Mastodon public hashtag timelines on the configured instance.
- Public RSS/Atom feed entries supplied in `NEWS_RSS_FEEDS`.

Optional environment variables:
- Reddit: `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_USER_AGENT`, `REDDIT_REFRESH_TOKEN`.
- YouTube: `YOUTUBE_API_KEY`.
- Mastodon: `MASTODON_INSTANCE_URL` and optionally `MASTODON_ACCESS_TOKEN`.
- RSS/Atom: `NEWS_RSS_FEEDS` as a comma-separated list of feed URLs.
- Collection cadence: `COLLECTION_INTERVAL_MS` (default 900000; minimum 60000).

Collector outcomes are written to `collection_runs`; authenticated administrators can inspect recent runs at `GET /v1/admin/monitoring/collection-runs`. Missing credentials are recorded as partial coverage, not as a successful connection. Platform quotas, API permissions, public availability and source terms remain in force. This is not a complete platform-wide firehose. This deployment is restricted to free official APIs, public endpoints and RSS feeds; no paid provider is enabled or required.


### Browser push notifications

- The dashboard includes an explicit **Enable notifications** control. A visitor must grant browser notification permission on each device/browser.
- Configure `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` in the backend host's secret environment. Never commit the private key.
- `GET /v1/notifications/public-key` returns the public VAPID key.
- `POST /v1/notifications/subscribe` stores a browser's Web Push subscription in `push_subscriptions`; `POST /v1/notifications/unsubscribe` removes it.
- Newly ingested, deduplicated public records trigger push notifications to subscribed devices. Notifications are sent when a collector discovers a record; delivery timing still depends on source collection cadence, provider availability and push-service delivery.
- Expired subscriptions (HTTP 404/410) are automatically removed. Users can revoke permission in their browser settings at any time.
- Database schema: `migrations/003_push_subscriptions.sql`.

### Account authorization and browser automation

- Use each platform's official OAuth/approved API authorization flow for account connections. A user must complete sign-in and consent directly with the platform.
- Do not collect passwords, one-time codes, session cookies, or reuse browser profiles to bypass platform access controls. Selenium/Chromium can be used for public-page QA and permitted browser workflows, not as a substitute for an approved API grant or to evade platform restrictions.
- The current collectors only access sources listed as implemented above. An integration-catalog entry is not proof that a platform is connected or that all posts/replies are available.
