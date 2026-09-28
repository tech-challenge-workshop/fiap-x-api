# Observability — FIAP X API Specification

Part of S8 (observability and autoscale), split across 5 sibling specs (`fiap-x-api` OBS-01..15, `processing-catalog` OBS-16..30, `processing-worker` OBS-31..45, `notification-service` OBS-46..60, `fiap-x-platform` OBS-61..75) per the hackathon gap analysis. This repo's job: originate the `correlationId` at the HTTP edge, emit structured logs and the request-level metrics, and split health into readiness/liveness.

## Problem Statement

The API emits no structured logs, no metrics, and its only health signal is a fixed `{status:'ok'}` that never reflects real state. Without a correlation id an upload cannot be traced from the HTTP edge to the terminal email, and without `/metrics` the hackathon's observability requirement (RT-2, recommended stack) has no evidence. The `foudation.md` already promises structured logs with a propagated `correlationId` and a `/metrics` endpoint per service.

## Goals

- [ ] Every log line the API emits is JSON carrying the request's `correlationId`; no line ever contains the owner's email, the bearer token, or a presigned URL.
- [ ] `GET /metrics` exposes the foundation's request-level metrics (uploads accepted/rejected, downloads authorized/denied, HTTP traffic) in Prometheus text format.
- [ ] Readiness (`/health`) and liveness (`/health/live`) are separate endpoints with semantics consistent with the other three services.

## Out of Scope

| Feature | Reason |
| --- | --- |
| Distributed tracing (OpenTelemetry) | Explicitly optional in the S8 scope (gap analysis) |
| Alerting | "Alertas em produção" is out of S8 scope |
| Broker queue metrics | Owned by the RabbitMQ Prometheus plugin wired in `fiap-x-platform`, not the API |
| Auth on `/metrics` and `/health` | Local network; scraping convention is unauthenticated |
| KEDA / horizontal autoscale | S9a; S8 only exposes the metrics that will drive it |
| Refactoring the 12 existing e2e suites to a shared listen helper | That is spec G work (`api-test-hardening`, V40); S8's new suites simply bind `127.0.0.1` from the start |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Logging stack | `nestjs-pino`, JSON logs, `pino-http` access log, redaction of `req.headers.authorization` and cookie fields | User picked nestjs-pino (2026-09-28); standard for NestJS structured logging; redaction enforces AD-015 (email never logged) mechanically | y |
| correlationId transport | Contract field `correlationId` on every event DTO plus a nullable `processing_request.correlation_id` column in the Catalog; generated at this edge, propagated downstream; consumers generate one when absent | The S8 seed criterion requires the *propagated* id on every service; the foundation doc promises propagation "desde o upload" | n (user skipped; default chosen — review at confirm) |
| `X-Correlation-Id` handling | Accept inbound header when non-blank and ≤ 128 chars (printable ASCII); otherwise replace with a generated id — never a 500 | L-005: client-influenced values need a bound and a defined fallback | n (default) |
| Load evidence | Versioned `scripts/load-test.mjs` in `fiap-x-platform` with `--self-test`, run at small N in CI | The project's "pronto quando" gates are all repeatable scripts | n (default) |
| `/health` vs `/health/live` | `/health` = readiness (200 once the app is serving; the API has no hard startup dependency — JWKS is fetched lazily), `/health/live` = liveness | Matches the worker service's existing split; readiness must not flap on lazy JWKS fetches | n (default) |
| Metric labels | Bounded labels only (`method`, `route`, `status`, `outcome`); no owner ids, emails, or request ids as labels | Cardinality + PII (AD-015); correlation lives in logs | n (default) |
| Access-log noise | `/health`, `/health/live`, and `/metrics` requests produce no access log line | Scraping/health probes would flood the log | n (default) |
| New e2e suites | Bind `127.0.0.1` via a shared test helper (`await app.listen(0, '127.0.0.1')`) so S8 does not add more intermittently-flaky suites | Mitigates V40 until spec G fixes the 12 existing suites | n (default) |

**Open questions:** none — all resolved or logged above.

---

## User Stories

### P1: Structured logs with correlationId ⭐ MVP

**User Story**: As an operator, I want every API log line in JSON carrying the request's correlationId (originated here, propagated to the Catalog over HTTP and into the pipeline) so that I can trace one upload from edge to email.

**Why P1**: It is the observable half of the S8 seed criteria and the prerequisite for cross-service correlation.

**Acceptance Criteria**:

1. WHEN any request reaches the API THEN the API SHALL assign a `correlationId` — the inbound `X-Correlation-Id` when it is non-blank and at most 128 printable-ASCII chars, otherwise a freshly generated id — and SHALL make it available to every log line emitted while handling that request. <!-- event-driven -->
2. WHEN the API emits any log line THEN the line SHALL be a single JSON object carrying at least `timestamp`, `level`, `msg` and `service`, and SHALL be emitted through the shared pino instance. <!-- event-driven -->
3. WHEN the API calls the Catalog over HTTP THEN it SHALL forward the request's `correlationId` in the `X-Correlation-Id` header. <!-- event-driven -->
4. WHEN the API confirms an upload (creates the processing request) THEN it SHALL include the request's `correlationId` so the Catalog persists and propagates it on events. <!-- event-driven -->
5. IF the inbound `X-Correlation-Id` is blank, longer than 128 chars, or contains non-printable characters THEN the API SHALL replace it with a generated id and SHALL NOT fail the request. <!-- unwanted-behavior -->
6. WHEN a log line is emitted for a request that carried an owner email claim THEN the line SHALL NOT contain that email address; the redaction configuration SHALL cover it independently of developers remembering. <!-- event-driven -->
7. The API SHALL NOT emit an access-log line for requests to `/health`, `/health/live`, or `/metrics`. <!-- ubiquitous -->

**Independent Test**: Boot the API, call `POST /uploads` with `X-Correlation-Id: demo-123`, and grep the captured logs: every line of that request carries `"correlationId":"demo-123"`, the internal Catalog call carries the same header, and no line contains the alice email or the bearer token.

---

### P2: Prometheus metrics and split health

**User Story**: As an operator, I want `/metrics` with the foundation's request-level metrics and separate readiness/liveness endpoints so that Prometheus can scrape the API and the platform stack can tell alive from ready.

**Why P1**: It is the second half of the observability requirement and the source of the upload/download evidence for the Grafana dashboard.

**Acceptance Criteria**:

1. WHEN Prometheus (or any client) issues `GET /metrics` THEN the API SHALL respond 200 with `Content-Type: text/plain; version=0.0.4` and the exposed metric set SHALL include `fiapx_http_requests_total{method,route,status}`, `fiapx_http_request_duration_seconds`, `fiapx_uploads_total{outcome="accepted|rejected"}` and `fiapx_downloads_total{outcome="authorized|denied"}`. <!-- event-driven -->
2. WHEN an upload is rejected at the edge THEN the API SHALL increment `fiapx_uploads_total` with `outcome="rejected"` and SHALL NOT increment `outcome="accepted"`. <!-- event-driven -->
3. WHEN a download is requested by a non-owner or for a non-`COMPLETED` request THEN the API SHALL increment `fiapx_downloads_total` with `outcome="denied"`. <!-- event-driven -->
4. WHEN any client issues `GET /health` THEN the API SHALL respond 200 while the process is serving requests. <!-- event-driven -->
5. WHEN any client issues `GET /health/live` THEN the API SHALL respond 200 while the event loop is responsive, independent of any external dependency. <!-- event-driven -->
6. The metric exposition and health endpoints SHALL NOT require authentication. <!-- ubiquitous -->

**Independent Test**: Scrape `/metrics` after one accepted upload, one rejected upload, and one foreign-owner download attempt; the counters above reflect exactly those three outcomes; `/health` and `/health/live` both return 200 on a booted app.

---

## Edge Cases

- IF the inbound `X-Correlation-Id` exceeds 128 chars THEN it is replaced with a generated id and the request proceeds (OBS-05).
- IF a log payload would include `req.headers.authorization` THEN pino redaction replaces it before emission.
- IF the owner email appears anywhere in a log argument THEN the redaction paths SHALL also cover it (defense in depth behind the S7 "never logged" rule).
- WHEN `/metrics` is scraped concurrently with traffic THEN exposition SHALL NOT block request handling (registry snapshot, not live collection).
- IF pino is misconfigured to pretty-print THEN CI SHALL fail (a unit test pins the JSON shape).

---

## Implicit-Requirement Dimensions Sweep

| Dimension | Resolution |
| --- | --- |
| Input validation & bounds | OBS-05 caps `X-Correlation-Id` at 128 printable chars |
| Failure / partial-failure | N/A — logging/metrics are side-effects; a logging failure must not fail the request (pino async behavior) |
| Idempotency / retry / duplicate | N/A — read-only observation of existing idempotent flows |
| Auth boundaries | `/health`, `/health/live`, `/metrics` stay public (assumption table) |
| Concurrency / ordering | ALS-based correlation context is per-request under concurrent load (validated via the P1 independent test) |
| Data lifecycle / expiry | N/A — logs/metrics are ephemeral runtime signals |
| Observability | this feature |
| External-dependency failure | Readiness stays 200 on lazy-JWKS failure by design (documented above) |
| State-transition integrity | N/A — no state changes |

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| OBS-01 | P1: Structured logs (assign id) | Design | Implementing (edge middleware wired in T4, probe-verified; e2e in T16) |
| OBS-02 | P1: Structured logs (JSON shape) | Design | Implementing (config unit-verified in T2, module wired in T3, bootstrap smoke-verified in T5; e2e in T16) |
| OBS-03 | P1: Structured logs (forward header) | Design | Pending |
| OBS-04 | P1: Structured logs (confirm carries id) | Design | Pending |
| OBS-05 | P1: Structured logs (invalid header) | Design | Implementing (parser unit-verified in T1; edge replacement lands in T4/T16) |
| OBS-06 | P1: Structured logs (email redaction) | Design | Implementing (redaction unit-verified in T2; depth bounded to root + one level; e2e in T16) |
| OBS-07 | P1: Structured logs (endpoint noise) | Design | Implementing (autoLogging.ignore unit-verified in T2; e2e in T16) |
| OBS-08 | P2: Metrics (exposition set) | Design | Implementing (registry T6, middleware T7, controller unit-verified in T8; e2e in T16) |
| OBS-09 | P2: Metrics (rejected uploads) | Design | Implementing (registry T6, edge filter unit-verified in T10, accepted counter lands in T15; e2e in T16) |
| OBS-10 | P2: Metrics (denied downloads) | Design | Implementing (registry unit-verified in T6; edge call site in T11; e2e in T16) |
| OBS-11 | P2: Health (readiness) | Design | Implementing (`/health` serves since initial slice; semantics documented; e2e in T16) |
| OBS-12 | P2: Health (liveness) | Design | Implementing (`/health/live` wired in T9; e2e in T16) |
| OBS-13 | P2: Health/Metrics (no auth) | Design | Implementing (metrics route @Public unit-pinned in T8; liveness/health e2e in T16) |

**ID format:** `OBS-[NUMBER]` — this repo owns OBS-01..15; `processing-catalog` owns OBS-16..30; `processing-worker` OBS-31..45; `notification-service` OBS-46..60; `fiap-x-platform` OBS-61..75.

**Coverage:** 13 total, 0 mapped to tasks, 13 unmapped (mapping happens in Tasks).

---

## Success Criteria

- [ ] One upload's complete log trail inside the API shares a single `correlationId`, and no log line contains an email, token, or presigned URL.
- [ ] `/metrics` returns 200 with the four required metric families after the traffic mix from the P2 independent test.
- [ ] `/health` and `/health/live` respond 200 on a healthy boot and are wired into the platform scrape/health conventions.
