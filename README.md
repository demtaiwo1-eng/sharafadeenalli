# CampTech Oyo — backend API

This repository now contains an initial Node.js/PostgreSQL API foundation. It is source code, not a deployed or production-hardened service yet.

## Included
- Express API with Helmet security headers, CORS allow-list support and request rate limiting.
- PostgreSQL connection pool and initial schema migration.
- Public, published-update listing and keyword search.
- Aggregate topic/source monitoring summary.
- Publicly visible project listing.
- Token-protected admin ingestion endpoint for sourced public updates.
- Dockerfile and environment template.

## API routes
- `GET /health` — API/database readiness.
- `GET /v1/public/updates?limit=30&q=term` — published records, source links and verification labels.
- `GET /v1/monitoring/summary?from=ISO_DATE&to=ISO_DATE` — aggregate source/topic counts.
- `GET /v1/operations/projects` — public projects only.
- `POST /v1/admin/updates` — protected ingestion endpoint; requires `Authorization: Bearer <ADMIN_API_TOKEN>`.

## Deploy and configure
1. Provision a managed PostgreSQL database (Neon is suitable for an initial managed database).
2. Deploy this repository as a Node 20 web service or Docker service on a host that supports persistent server processes.
3. Set environment variables from `.env.example` in the host's secret/configuration panel. Never commit actual secrets.
4. Set `CORS_ORIGIN` to the exact website origin, for example `https://demtaiwo1-eng.github.io` (origin only; no path).
5. Set a long random `ADMIN_API_TOKEN` in the host secret store.
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
