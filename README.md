# CampTech Oyo — platform backend

This repository is the planned backend and service specification for CampTech Oyo. It is not yet a deployed API.

## Service domains
- **Public content:** announcements, public updates, source attribution and correction history.
- **Media monitoring:** public-source collection, keyword matching, deduplication, source classification and aggregate trends.
- **Operations:** projects, tasks, milestones, event logistics and stakeholder organisations.
- **Field reports:** structured observations with timestamps, location granularity, review state and access controls.
- **Reporting:** aggregate dashboards and exportable reports.
- **Identity and audit:** authentication, role-based permissions, consent and immutable audit events.

## Suggested implementation sequence
1. Agree data model, roles, retention rules and API contracts.
2. Implement authentication, audit trail and PostgreSQL schema.
3. Implement public content and operations APIs.
4. Add compliant public-source ingestion through queued workers.
5. Add field reporting, review workflow and aggregate reports.
6. Add CDN caching, rate limiting, observability and load testing.
7. Deploy to multi-zone autoscaling infrastructure and conduct independent security review.

## Scale design
Use a CDN/edge cache for public reads, stateless horizontally scalable API instances, a managed PostgreSQL cluster with pooling and read replicas, object storage for media, and queue-backed workers for ingestion and report generation. Do not make every visitor query the primary database. Use bounded pagination, cache keys, request budgets and back-pressure.

Before claiming support for one million concurrent users, define and load-test explicit targets for requests/second, active connections, write throughput, p95/p99 latency, error rate, geographic mix and recovery time. No architecture can honestly promise uninterrupted service without tested capacity and operational budgets.

## Trust, privacy and compliance
- Use public and authorised data sources only; respect source terms and applicable Nigerian law.
- Do not evade authentication, paywalls, robots restrictions or rate limits.
- Preserve provenance and collection timestamps; mark unverified claims as unverified.
- Use aggregate public-topic analysis. Do not infer or store individuals' political opinions, build voter profiles, or target political persuasion to individuals.
- Minimise personal data, restrict field-level access, encrypt sensitive records and define deletion/retention policies.
- Store credentials in the hosting provider's secret manager, never in Git.
