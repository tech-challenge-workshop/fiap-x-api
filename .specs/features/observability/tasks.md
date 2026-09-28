# Observability Tasks — FIAP X API

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: `.specs/features/observability/design.md`
**Status**: Draft

> **Merge order**: this branch merges before `fiap-x-platform`'s S8 PR. The platform PR carries the regenerated `db/create-database.sql` only for the Catalog migration — this repo has no migration, so it can merge in any order relative to the other services.

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec - confirm before Execute. Guidelines found: CI workflow (`.github/workflows/ci.yml`: unit with coverage, e2e fail-on-skipped, lint `--max-warnings 0`, typecheck, build); `package.json` scripts; existing specs `src/**/*.spec.ts` + `test/*.e2e-spec.ts`.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------ | -------------------- | ---------------- | ----------- |
| Observability infra (context, logger config, metrics) | unit | All branches; every listed edge case (L-005 bounds, L-010 strict types, redaction paths, endpoint noise) | `src/observability/*.spec.ts` | `npm test` |
| Adapters / services touched (upload, download, catalog client) | unit | 1:1 to touched ACs; happy + edge + error | colocated `*.spec.ts` | `npm test` |
| HTTP surface (metrics, health, auth bypass, log shape) | e2e | Every new route: happy + edge + error; full correlation chain | `test/*.e2e-spec.ts` (new suites bind `127.0.0.1` via `test/support/listen.ts`) | `npm run test:e2e` |
| Config / module wiring / main.ts | none | - (build gate only) | - | build gate only |

## Gate Check Commands

> Generated from `package.json` - confirm before Execute.

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | After tasks with unit tests only | `npm test` |
| Full | After tasks touching routes/e2e | `npm test && npm run test:e2e` |
| Build | After phase completion or config-only tasks | `npm run lint && npm run typecheck && npm test && npm run test:e2e && npm run build` |

---

## Execution Plan

Phases are ordered and run sequentially - each phase completes before the next begins, and tasks within a phase execute in order. Dependencies are pure chains: each task depends only on the previous one (transitively covering earlier work).

### Phase 1: Observability foundation

```
T1 -> T2 -> T3 -> T4 -> T5 -> T6
```

### Phase 2: Metrics and health

```
T6 -> T7 -> T8 -> T9 -> T10 -> T11 -> T12
```

### Phase 3: Correlation threading

```
T12 -> T13 -> T14 -> T15 -> T16
```

### Phase 4: End-to-end verification

```
T16
```

---

## Task Breakdown

### T1: CorrelationContext (ALS + strict parser)

**What**: AsyncLocalStorage context with `runWithCorrelation`, `getCorrelationId`, `getOrGenerateCorrelationId`, and `parseCorrelationId` (trim, then accept only `/^[\x20-\x7E]{1,128}$/`; anything else → null).
**Where**: `src/observability/correlation-context.ts`
**Depends on**: None
**Reuses**: `node:async_hooks`, `node:crypto`
**Requirement**: OBS-05 (shared foundation for OBS-01..04)

**Tools**: Skill: `tlc-spec-driven` (per protocol); MCP: NONE

**Done when**:

- [x] Context is isolated per concurrent run (two interleaved runs see distinct ids)
- [x] Parser accepts 1..128 printable ASCII after trim; rejects blank, 129+ chars, non-strings (number/object/null → null, never coerced — L-010), control chars
- [x] Gate check passes: `npm test`
- [x] Test count: 10 new unit tests pass (no silent deletions)

**Tests**: unit
**Gate**: quick

**Commit**: `feat(api): add the correlation context for observability`

**Status**: ✅ Complete. `src/observability/correlation-context.ts` holds the ALS-based `CorrelationContext` (class, DI-ready singleton) plus the strict `parseCorrelationId` (trim, `/^[\x20-\x7E]{1,128}$/`, non-strings → null without coercion). 10 new unit tests in `correlation-context.spec.ts` (unit 152 → 162, 0 failed).

---

### T2: Pino root logger config

**What**: Logger config module: root `mixin` injecting `correlationId` from the ALS (omitted when undefined), `redact` paths (`req.headers.authorization`, `req.headers.cookie`, `*.ownerEmail`, `*.email`, `*.zipStorageKey`, `*.sourceStorageKey`), `autoLogging.ignore` for `/health`, `/health/live`, `/metrics`, level from `LOG_LEVEL` (default `info`), `genReqId` mirroring the middleware's validated id.
**Where**: `src/observability/logger.config.ts`
**Depends on**: T1
**Reuses**: T1 CorrelationContext
**Requirement**: OBS-02, OBS-06, OBS-07

**Tools**: Skill: `tlc-spec-driven` (per protocol); MCP: NONE

**Done when**:

- [x] A pino instance built from this config emits one JSON object per line carrying `timestamp`, `level`, `msg`, `service: 'fiap-x-api'`, and the ALS `correlationId` when set
- [x] Redaction replaces the listed paths in nested objects; an email-like value under any `email`/`ownerEmail` key never survives
- [x] `autoLogging.ignore` matches the three endpoints exactly (and only them)
- [x] Gate check passes: `npm test`
- [x] Test count: 8 new unit tests pass (no silent deletions)

**Tests**: unit
**Gate**: quick

**Commit**: `feat(api): add the structured logger config with redaction`

**Status**: ✅ Complete. `logger.config.ts` builds the root config from a `CorrelationContext`: mixin injects `service` on every line plus `correlationId` when ALS-scoped, `timestamp` key per OBS-02 (pino default is `time`), redaction with `remove: true`, `genReqId` mirroring the middleware rule, `autoLogging.ignore` for the three endpoints, `LOG_LEVEL` default `info`. Two SPEC_DEVIATIONs (marked in code): bare root keys added to the redact paths (`*.x` needs a parent key, so root-level `{ ownerEmail }` survived) and `service` moved from `customProps` into the mixin (customProps never reaches root-instance lines, breaking the OBS-02 "any log line" outcome). 8 new unit tests in `logger.config.spec.ts` (unit 162 → 170, 0 failed). Gap noted: pino redact paths bound depth to root + one level.

---

### T3: ObservabilityModule

**What**: Nest module importing `LoggerModule.forRoot(rootConfig)` and providing CorrelationContext as a shared singleton.
**Where**: `src/observability/observability.module.ts`
**Depends on**: T2
**Reuses**: nestjs-pino `LoggerModule`
**Requirement**: OBS-02

**Tools**: Skill: `tlc-spec-driven` (per protocol); MCP: NONE

**Done when**:

- [x] Module compiles and exports what AppModule needs
- [x] Gate check passes: `npm run lint && npm run typecheck && npm run build`
- [x] Test count: no new tests (config layer - matrix)

**Tests**: none
**Gate**: build

**Commit**: `feat(api): add the observability module`

**Status**: ✅ Complete. `observability.module.ts` provides one process-wide `CorrelationContext` (useValue singleton, so the pino mixin and injected consumers share the same ALS store) and imports `LoggerModule.forRootAsync` with a lazy `useFactory` over that instance. Includes two lint fixes on T2's files, caught here because T3 is the first build gate (`no-unsafe-argument` on the Writable chunk, unnecessary `LevelWithSilent` cast). No new tests per matrix; lint, typecheck, unit 170/170, build all green.

---

### T4: Wire module + middleware into AppModule

**What**: Import ObservabilityModule; register CorrelationMiddleware for all routes via `MiddlewareConsumer`; `app.useLogger(app.get(Logger))` + `app.useLogger` flush in bootstrap.
**Where**: `src/app.module.ts`
**Depends on**: T3
**Reuses**: T1 middleware (`CorrelationMiddleware` in `src/observability/correlation.middleware.ts` — created here alongside the registration, ~25 lines)
**Requirement**: OBS-01, OBS-03

**Tools**: Skill: `tlc-spec-driven` (per protocol); MCP: NONE

**Done when**:

- [x] A booted app answers `GET /health` with `x-correlation-id` response header (generated) and echoes a valid inbound `X-Correlation-Id`
- [x] Gate check passes: `npm run lint && npm run typecheck && npm run build`
- [x] Test count: asserted in T16's e2e (wiring layer - matrix); no unit tests

**Tests**: none
**Gate**: build

**Commit**: `feat(api): wire the correlation middleware and logger into the app`

**Status**: ✅ Complete. `CorrelationMiddleware` (~25 lines: parse inbound header, generate on invalid, `res.setHeader`, `ALS.run` around `next`) created alongside the registration, per the task's cohesive-scope note. AppModule imports ObservabilityModule and applies the middleware via `MiddlewareConsumer.forRoutes('*')`. Booted-app behavior verified with a throwaway in-process probe (deleted before commit): `GET /` with `X-Correlation-Id: demo-123` answers the echoed header and the access-log line carries `"correlationId":"demo-123"` — response `finish` stays inside the ALS scope, so no extra wiring was needed for access-line correlation. Full assertions deferred to T16 e2e per matrix.

---

### T5: Bootstrap pino as the app logger

**What**: `main.ts` uses `NestFactory.create(AppModule, { bufferLogs: true })`, `app.useLogger(app.get(Logger))`, `app.flushLogs()` on bootstrap; existing ValidationPipe untouched.
**Where**: `src/main.ts`
**Depends on**: T4
**Reuses**: nestjs-pino `Logger`
**Requirement**: OBS-02

**Tools**: Skill: `tlc-spec-driven` (per protocol); MCP: NONE

**Done when**:

- [x] `npm run start:prod` boots with JSON logs and the global ValidationPipe still rejects non-whitelisted bodies
- [x] Gate check passes: `npm run lint && npm run typecheck && npm run build`
- [x] Test count: no new tests (bootstrap layer - matrix)

**Tests**: none
**Gate**: build

**Commit**: `feat(api): bootstrap the pino logger in main`

**Status**: ✅ Complete. `main.ts` now creates the app with `bufferLogs: true`, switches to the pino `Logger` via `app.useLogger(app.get(Logger))`, and calls `app.flushLogs()` after listen; the ValidationPipe block is byte-identical. Smoke-checked the built server: boot logs are one-line JSON carrying `timestamp`/`level`/`service`/`msg`, and `GET /health` answers 200 with a generated `x-correlation-id`. Whitelist rejection stays covered by the existing e2e suites (untouched pipe). Full phase gate after T5 green: lint, typecheck, unit 170/170, build.

---

### T6: ApiMetrics registry + counters

**What**: Dedicated `Registry` (not the prom-client global), `fiapx_uploads_total{outcome}`, `fiapx_downloads_total{outcome}`, `fiapx_http_requests_total{method,route,status}`, `fiapx_http_request_duration_seconds`; `resetMetrics()` for tests.
**Where**: `src/observability/metrics.ts`
**Depends on**: T5
**Reuses**: prom-client
**Requirement**: OBS-08, OBS-09, OBS-10

**Tools**: Skill: `tlc-spec-driven` (per protocol); MCP: NONE

**Done when**:

- [x] Counters increment exactly once per call; labels bounded to the spec sets
- [x] `resetMetrics()` returns every metric to zero without re-registering duplicates
- [x] Gate check passes: `npm test`
- [x] Test count: 6 new unit tests pass (no silent deletions)

**Tests**: unit
**Gate**: quick

**Commit**: `feat(api): add the fiapx metrics registry and outcome counters`

**Status**: ✅ Complete. `metrics.ts` holds `ApiMetrics` on a dedicated `Registry` (never the prom-client global) with the four families — `fiapx_uploads_total{outcome}`, `fiapx_downloads_total{outcome}`, `fiapx_http_requests_total{method,route,status}`, `fiapx_http_request_duration_seconds{method,route,status}` — plus `metrics()`, `resetMetrics()`, and one process-wide `apiMetrics` instance (same use-one-instance convention as the correlation context, so edge call sites share the registry without module wiring no task lists). 6 new unit tests in `metrics.spec.ts` assert the exposition text, the untouched global registry, and reset-then-re-record without duplicates (unit 170 → 176, 0 failed).

---

### T7: HTTP metrics middleware

**What**: Express middleware recording request counts + duration with the route template (unmatched → `'unmatched'`); registered after routes in AppModule; wrapped so it can never throw into the pipeline.
**Where**: `src/observability/http-metrics.middleware.ts`
**Depends on**: T6
**Reuses**: T6 registry
**Requirement**: OBS-08

**Tools**: Skill: `tlc-spec-driven` (per protocol); MCP: NONE

**Done when**:

- [x] One accepted request and one 404 produce exactly one series each, with `route` equal to the template for the former and `'unmatched'` for the latter
- [x] Gate check passes: `npm test`
- [x] Test count: 4 new unit tests pass (no silent deletions)

**Tests**: unit
**Gate**: quick

**Commit**: `feat(api): add the http metrics middleware`

**Status**: ✅ Complete. `HttpMetricsMiddleware` counts on response `finish` with the express route template (`'unmatched'` when none — bounded cardinality) and elapsed seconds, all inside try/catch so counting can never fail a request. Registered in `AppModule.configure` via `apply(CorrelationMiddleware, HttpMetricsMiddleware)` — the registration touch the task's Where omits. 4 new unit tests in `http-metrics.middleware.spec.ts` drive a real express app: template vs unmatched series, exactly-once counting over three requests, and pipeline-survival when counting throws (unit 176 → 180, 0 failed; lint clean).

---

### T8: /metrics controller (@Public)

**What**: `GET /metrics` returning `registry.metrics()` with `Content-Type: text/plain; version=0.0.4`; `@Public()` so the global JwtAuthGuard does not 401 the scraper; excluded from access logs via T2's ignore list.
**Where**: `src/observability/metrics.controller.ts`
**Depends on**: T7
**Reuses**: T6 registry
**Requirement**: OBS-08, OBS-13

**Tools**: Skill: `tlc-spec-driven` (per protocol); MCP: NONE

**Done when**:

- [x] `GET /metrics` responds 200 with the exposition format and all four families after traffic
- [x] Request without a JWT is not challenged (guard bypass verified)
- [x] Gate check passes: `npm test && npm run test:e2e` (existing e2e green)
- [x] Test count: 3 new unit tests pass (no silent deletions); e2e assertions in T16

**Tests**: unit
**Gate**: quick

**Commit**: `feat(api): expose the prometheus metrics endpoint`

**Status**: ✅ Complete. `MetricsController` (`@Public() @Controller()`, `@Get('metrics')`) serves `apiMetrics.metrics()` via raw `setHeader` + `res.end` — express's `res.send` reflects `; charset=utf-8` into the Content-Type, and the OBS-08 contract pins `text/plain; version=0.0.4` exactly. Registered in ObservabilityModule's controllers (the module touch the task omits). 3 new unit tests in `metrics.controller.spec.ts` (unit 180 → 183, 0 failed). Cross-feature impact: `test/processing-requests.e2e-spec.ts` pins the exact route surface; S8 legitimately adds `GET /metrics` (OBS-08/13) and the two all-route middleware wildcards, so the pinned list gains `GET /metrics` and the enumeration now excludes `{*splat}` middleware catch-alls — the business-route pinning stays an exact `toEqual`. E2e green: 12/12 suites (14 skips are the pre-existing RustFS-env gates).

---

### T9: Liveness endpoint

**What**: `GET /health/live` returning 200 while serving; keep existing `GET /health` readiness semantics.
**Where**: `src/health/health.controller.ts`
**Depends on**: T8
**Reuses**: existing controller (`@Public()` already present)
**Requirement**: OBS-11, OBS-12

**Tools**: Skill: `tlc-spec-driven` (per protocol); MCP: NONE

**Done when**:

- [x] Both endpoints return 200 on a booted app without a token
- [x] Gate check passes: `npm test && npm run test:e2e`
- [x] Test count: e2e assertions in T16; no new unit tests

**Tests**: none
**Gate**: quick

**Commit**: `feat(api): add the liveness endpoint`

**Status**: ✅ Complete. `GET /health/live` added to the existing `@Public()` HealthController, returning `{status:'ok'}` — liveness is 200 while the event loop serves, readiness (`/health`) semantics untouched (AD-017 split; the API has no hard startup dependency, JWKS fetches lazily). No new unit tests per task/matrix (route assertions consolidated in T16's e2e). Same cross-feature surface pin as T8: `test/processing-requests.e2e-spec.ts` gains `GET /health/live` in its exact route list (OBS-12 mandated). Gates green: unit 183/183, e2e 12/12 (14 pre-existing env skips).

---

### T10: Upload-outcome counters at the edges

**What**: `recordUpload('rejected')` on start-upload validation rejection (type/size); `recordUpload('accepted')` on successful confirm.
**Where**: `src/uploads/start-upload.service.ts`
**Depends on**: T9
**Reuses**: T6 ApiMetrics; rejected-path call lands in the complete-upload confirm in T13
**Requirement**: OBS-09

**Tools**: Skill: `tlc-spec-driven` (per protocol); MCP: NONE

**Done when**:

- [x] Rejected start increments only `outcome="rejected"` (unit, adapter-isolated)
- [x] Gate check passes: `npm test`
- [x] Test count: 3 new unit tests pass (no silent deletions)

**Tests**: unit
**Gate**: quick

**Commit**: `feat(api): count rejected uploads at the edge`

**Status**: ✅ Complete. The type/size validation runs in the global ValidationPipe before `StartUploadService` executes, so the counting hook is `RejectedUploadMetricFilter` (`@Catch(BadRequestException)`, lives in the task's pinned file) registered via `@UseFilters` on the controller's `start` method (wiring the task omits; method-scoped so complete-upload 400s are not miscounted). Nest runs exactly one filter per throw, so the filter counts then delegates to the existing `CatalogErrorFilter`, keeping the controller's `{statusCode, message}` error contract byte-identical — verified by the full e2e suite (the first pass re-shaped bodies and 13 e2e tests caught it; delegation fixed it). 3 new unit tests in `start-upload.service.spec.ts` (unit 183 → 186, 0 failed; e2e 12/12).

---

### T11: Download-outcome counters

**What**: `recordDownload('authorized'|'denied')` on the download path: denied for non-owner or non-`COMPLETED`, authorized when a URL is issued.
**Where**: `src/processing-requests/download.service.ts`
**Depends on**: T10
**Reuses**: T6 ApiMetrics
**Requirement**: OBS-10

**Tools**: Skill: `tlc-spec-driven` (per protocol); MCP: NONE

**Done when**:

- [ ] Each outcome increments exactly its label (unit, happy + both denial causes)
- [ ] Gate check passes: `npm test`
- [ ] Test count: 4 new unit tests pass (no silent deletions)

**Tests**: unit
**Gate**: quick

**Commit**: `feat(api): count download authorizations and denials`

---

### T12: CatalogClient port gains correlationId

**What**: `createProcessingRequest` input gains optional `correlationId`; port interface + docs updated.
**Where**: `src/processing-requests/ports/catalog-client.port.ts`
**Depends on**: T11
**Reuses**: existing port
**Requirement**: OBS-03, OBS-04

**Tools**: Skill: `tlc-spec-driven` (per protocol); MCP: NONE

**Done when**:

- [ ] Typecheck passes across the repo (adapters still compile - they are updated in T13/T14)
- [ ] Gate check passes: `npm run typecheck`
- [ ] Test count: no new tests (interface layer - matrix)

**Tests**: none
**Gate**: build

**Commit**: `feat(api): extend the catalog client port with the correlation id`

---

### T13: HTTP catalog adapter sends the id

**What**: Adapter sends `X-Correlation-Id` header and `correlationId` body field from the input.
**Where**: `src/processing-requests/adapters/http-catalog-client.adapter.ts`
**Depends on**: T12
**Reuses**: existing axios/fetch adapter
**Requirement**: OBS-03, OBS-04

**Tools**: Skill: `tlc-spec-driven` (per protocol); MCP: NONE

**Done when**:

- [ ] Adapter unit test captures both header and body field on the wire (fake server)
- [ ] Gate check passes: `npm test`
- [ ] Test count: 3 new unit tests pass (no silent deletions)

**Tests**: unit
**Gate**: quick

**Commit**: `feat(api): send the correlation id to the catalog over http`

---

### T14: In-memory adapter records the id

**What**: In-memory adapter stores `correlationId` on the created request record for assertions.
**Where**: `src/processing-requests/adapters/in-memory-catalog-client.adapter.ts`
**Depends on**: T13
**Reuses**: existing in-memory adapter
**Requirement**: OBS-04

**Tools**: Skill: `tlc-spec-driven` (per protocol); MCP: NONE

**Done when**:

- [ ] Adapter unit test asserts the recorded id
- [ ] Gate check passes: `npm test`
- [ ] Test count: 2 new unit tests pass (no silent deletions)

**Tests**: unit
**Gate**: quick

**Commit**: `feat(api): record the correlation id in the in-memory catalog adapter`

---

### T15: Confirm-upload passes the current correlation id

**What**: `CompleteUploadService` reads `getCorrelationId()` and passes it to `createProcessingRequest`; calls `recordUpload('accepted')` on success (complementing T10).
**Where**: `src/uploads/complete-upload.service.ts`
**Depends on**: T14
**Reuses**: T1 context, T6 metrics, T12 port
**Requirement**: OBS-03, OBS-04, OBS-09

**Tools**: Skill: `tlc-spec-driven` (per protocol); MCP: NONE

**Done when**:

- [ ] Confirm flow passes the request's id end-to-end (unit with in-memory adapter + existing e2e still green)
- [ ] Successful confirm increments `outcome="accepted"` exactly once (also on idempotent replay? No — replay returns the existing request without double-counting; the 200 replay path does NOT increment)
- [ ] Gate check passes: `npm test && npm run test:e2e`
- [ ] Test count: 4 new unit tests pass (no silent deletions)

**Tests**: unit
**Gate**: full

**Commit**: `feat(api): propagate the correlation id through upload confirmation`

---

### T16: Observability e2e sweep

**What**: New `test/observability.e2e-spec.ts` (binds `127.0.0.1` via `test/support/listen.ts`) asserting the spec outcomes in one suite: correlationId echoed + propagated to the catalog client (fake captures header/body), invalid `X-Correlation-Id` replaced with 200 and the generated id echoed, every log line of a request JSON with the same `correlationId` and free of token/email/zip key, no access-log lines for the three excluded endpoints, `/metrics` 200 unauthenticated with all four families after the traffic mix, `/health` + `/health/live` 200 unauthenticated.
**Where**: `test/observability.e2e-spec.ts`
**Depends on**: T15
**Reuses**: existing e2e harness + `test/support/capturing-logger.ts` pattern extended to stdout capture
**Requirement**: OBS-01..13

**Tools**: Skill: `tlc-spec-driven` (per protocol); MCP: NONE

**Done when**:

- [ ] All assertions above pass against the in-process app with existing fakes
- [ ] Gate check passes: `npm test && npm run test:e2e && npm run lint && npm run typecheck && npm run build`
- [ ] Test count: 12 new e2e tests pass (no silent deletions)

**Tests**: e2e
**Gate**: full

**Commit**: `test(api): prove the observability slice end to end`

---

## Phase Execution Map

```
Phase 1:  T1 -> T2 -> T3 -> T4 -> T5 -> T6
Phase 2:  T6 -> T7 -> T8 -> T9 -> T10 -> T11 -> T12
Phase 3:  T12 -> T13 -> T14 -> T15 -> T16
Phase 4:  T16
```

Execution is strictly sequential — one task at a time, gate before commit, one Conventional Commit per task.

---

## Task Granularity Check

| Task | Scope | Status |
| ---- | ----- | ------ |
| T1: CorrelationContext | 1 module | ✅ Granular |
| T2: logger config | 1 module | ✅ Granular |
| T3: ObservabilityModule | 1 module | ✅ Granular |
| T4: AppModule wiring (+middleware file) | 1 file + its middleware | ⚠️ Cohesive (middleware exists only for this registration) |
| T5: main.ts bootstrap | 1 file | ✅ Granular |
| T6: metrics registry | 1 module | ✅ Granular |
| T7: HTTP middleware | 1 module | ✅ Granular |
| T8: /metrics controller | 1 controller | ✅ Granular |
| T9: liveness | 1 route | ✅ Granular |
| T10: rejected-upload counter | 1 call site | ✅ Granular |
| T11: download counters | 1 service | ✅ Granular |
| T12: port interface | 1 interface | ✅ Granular |
| T13: HTTP adapter | 1 adapter | ✅ Granular |
| T14: in-memory adapter | 1 adapter | ✅ Granular |
| T15: confirm service threading | 1 service | ✅ Granular |
| T16: e2e sweep | 1 spec | ✅ Granular (verification slice per matrix e2e layer) |

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| ---- | ---------------------- | ------------- | ------ |
| T1 | none | none | ✅ Match |
| T2 | T1 | T1 -> T2 | ✅ Match |
| T3 | T2 | T2 -> T3 | ✅ Match |
| T4 | T3 | T3 -> T4 | ✅ Match |
| T5 | T4 | T4 -> T5 | ✅ Match |
| T6 | T5 | T5 -> T6 | ✅ Match |
| T7 | T6 | T6 -> T7 | ✅ Match |
| T8 | T7 | T7 -> T8 | ✅ Match |
| T9 | T8 | T8 -> T9 | ✅ Match |
| T10 | T9 | T9 -> T10 | ✅ Match |
| T11 | T10 | T10 -> T11 | ✅ Match |
| T12 | T11 | T11 -> T12 | ✅ Match |
| T13 | T12 | T12 -> T13 | ✅ Match |
| T14 | T13 | T13 -> T14 | ✅ Match |
| T15 | T14 | T14 -> T15 | ✅ Match |
| T16 | T15 | T15 -> T16 | ✅ Match |

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| ---- | --------------------------- | --------------- | --------- | ------ |
| T1 | observability infra | unit | unit | ✅ OK |
| T2 | observability infra | unit | unit | ✅ OK |
| T3 | config/module | none | none | ✅ OK |
| T4 | config/wiring | none | none (assertions deferred to T16 e2e) | ✅ OK |
| T5 | config/bootstrap | none | none | ✅ OK |
| T6 | observability infra | unit | unit | ✅ OK |
| T7 | observability infra | unit | unit | ✅ OK |
| T8 | controller | e2e (route) | unit + e2e in T16 | ⚠️ Route e2e consolidated in the T16 sweep (single verification phase; every new route is asserted there) |
| T9 | controller | e2e (route) | none + e2e in T16 | ⚠️ Same consolidation |
| T10 | service | unit | unit | ✅ OK |
| T11 | service | unit | unit | ✅ OK |
| T12 | interface | none | none | ✅ OK |
| T13 | adapter | unit | unit | ✅ OK |
| T14 | adapter | unit | unit | ✅ OK |
| T15 | service | unit | unit + existing e2e | ✅ OK |
| T16 | e2e layer | e2e | e2e | ✅ OK |
