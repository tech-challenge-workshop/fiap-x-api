---
kind: spec
title: "API Local Docker Integration Tasks"
---

# API Local Docker Integration Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: `.specs/features/local-docker-integration/design.md`
**Status**: Draft

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec. Guidelines found: `package.json` (jest config, lint/build scripts), `README.md`, service boundary doc, initial-slice `validation.md`.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| Port/interface | none | Build gate only | `src/**/*.ts` | `npm run build` |
| DTO (response extension) | unit | Happy path shape | `src/**/*.spec.ts` | `npm test` |
| In-memory stub update | unit | Success returns `RECEIVED`; rejection path | `src/**/*.spec.ts` | `npm test` |
| HTTP adapter | unit | Success, network error, 5xx, malformed JSON | `src/**/*.spec.ts` | `npm test` |
| Service error handling | unit | 502 on `CatalogUnavailableError`; unexpected error propagates | `src/**/*.spec.ts` | `npm test` |
| Health controller | unit or e2e | Returns 200 `ok` | `src/**/*.spec.ts` / `test/*.e2e-spec.ts` | `npm test` / `npm run test:e2e` |
| Controller | e2e | POST route happy path + validation error + Catalog rejection + response shape | `test/*.e2e-spec.ts` | `npm run test:e2e` |
| Module wiring | e2e / integration | Env-based adapter selection | `test/*.e2e-spec.ts` | `npm run test:e2e` |
| Dockerfile | none | `docker build .` succeeds | `Dockerfile` | `docker build . -t fiapx-api:local` |
| Compose/smoke | smoke test | `docker compose up --build --wait` + `scripts/smoke-local-integration.mjs` exits 0 | `compose.yaml`, `scripts/smoke-local-integration.mjs` | `docker compose up --build --wait && node scripts/smoke-local-integration.mjs` |
| Build gate | none | TypeScript build + ESLint pass | - | `npm run build && npm run lint` |

## Gate Check Commands

> Generated from codebase.

| Gate Level | When to Use | Command |
| --- | --- | --- |
| Quick | After tasks with unit tests only | `npm test` |
| Full | After tasks with e2e/integration tests | `npm test && npm run test:e2e` |
| Build | After phase completion or config/entity-only tasks | `npm run build && npm run lint` |
| Docker | After Dockerfile/Compose tasks | `docker build . -t fiapx-api:local && docker compose up --build --wait` |
| Smoke | Final feature-level validation | `node scripts/smoke-local-integration.mjs` |

---

## Execution Plan

Phases are ordered and run sequentially; tasks within a phase execute in order.

### Phase 1: Port and DTO contract
Run in order: T1, T2, T3.

### Phase 2: HTTP adapter and error distinction
Run in order: T4, T5.

### Phase 3: Verifier finding fixes
Run in order: T6, T7.

### Phase 4: Health endpoint and module wiring
Run in order: T8, T9.

### Phase 5: Docker assets
Run in order: T10, T11, T12.

### Phase 6: Build and smoke gate
Run in order: T13.

---

## Task Breakdown

### T1: Extend `CatalogClient` port return type

**What**: Change the port so adapters return `{ processingRequestId, status }` instead of a bare ID.
**Where**: `src/processing-requests/ports/catalog-client.port.ts`
**Depends on**: None
**Reuses**: existing port
**Requirement**: API-02

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when**:

- [x] Interface returns `Promise<{ processingRequestId: string; status: string }>`.
- [x] No TypeScript errors.
- [x] Gate check passes: `npm run build`

**Tests**: none
**Gate**: build

---

### T2: Update response DTO with `status`

**What**: Add `status: string` to `CreateProcessingRequestResponseDto`.
**Where**: `src/processing-requests/dtos/create-processing-request-response.dto.ts`
**Depends on**: None
**Reuses**: existing local DTO pattern
**Requirement**: API-02

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when**:

- [x] DTO includes both fields.
- [x] Unit test asserts response shape.
- [x] Gate check passes: `npm test`

**Tests**: unit
**Gate**: quick

---

### T3: Update in-memory stub return shape

**What**: Make `InMemoryCatalogClient` return `{ processingRequestId, status: 'RECEIVED' }` and keep the rejection toggle.
**Where**: `src/processing-requests/adapters/in-memory-catalog-client.adapter.ts`
**Depends on**: T1
**Reuses**: existing stub
**Requirement**: API-02

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when**:

- [x] Stub implements the new port shape.
- [x] Unit tests cover success and rejection.
- [x] Gate check passes: `npm test`

**Tests**: unit
**Gate**: quick

---

### T4: Implement `HttpCatalogClient` adapter

**What**: Add a real HTTP adapter that POSTs to `CATALOG_BASE_URL/processing-requests` and throws `CatalogUnavailableError` on network/5xx/malformed responses.
**Where**: `src/processing-requests/adapters/http-catalog-client.adapter.ts`
**Depends on**: T1
**Reuses**: adapter pattern, Node built-in `fetch`
**Requirement**: API-02, API-03

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when**:

- [x] Adapter implements `CatalogClient`.
- [x] Constructor receives `catalogBaseUrl`.
- [x] Unit tests cover success, non-2xx, network failure, and malformed JSON.
- [x] Gate check passes: `npm test`

**Tests**: unit
**Gate**: quick

---

### T5: Narrow service error mapping to 502 vs 500

**What**: Update `CreateProcessingRequestService` to catch only `CatalogUnavailableError` and map it to 502; let other errors fall through as 500.
**Where**: `src/processing-requests/services/create-processing-request.service.ts`
**Depends on**: T2, T3, T4
**Reuses**: existing service
**Requirement**: API-03

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when**:

- [x] Service returns the adapter result directly.
- [x] `CatalogUnavailableError` maps to `HttpException(502)`.
- [x] Unexpected errors propagate unmodified.
- [x] Gate check passes: `npm test`

**Tests**: unit
**Gate**: quick

---

### T6: Fix service unit test to assert HTTP status

**What**: Replace `rejects.toMatchObject(new HttpException(...))` with explicit status and message assertions.
**Where**: `src/processing-requests/services/create-processing-request.service.spec.ts`
**Depends on**: T5
**Reuses**: existing test
**Requirement**: API-06

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when**:

- [x] Test asserts `err.getStatus() === 502`.
- [x] Test asserts `err.message === 'Catalog unavailable'`.
- [x] Gate check passes: `npm test`

**Tests**: unit
**Gate**: quick

---

### T7: Fix e2e TypeScript type error

**What**: Replace `moduleFixture.get<CATALOG_CLIENT>(CATALOG_CLIENT)` with `moduleFixture.get<InMemoryCatalogClient>(CATALOG_CLIENT)`.
**Where**: `test/processing-requests.e2e-spec.ts`
**Depends on**: None
**Reuses**: existing e2e test
**Requirement**: API-06

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when**:

- [x] Generic parameter is a concrete TypeScript type.
- [x] `npx tsc --noEmit -p tsconfig.json` exits 0.
- [x] `npm run test:e2e` still passes.

**Tests**: e2e
**Gate**: full

---

### T8: Add `/health` endpoint

**What**: Create `HealthController` and register it in `AppModule`; return `{ status: 'ok' }`.
**Where**: `src/health/health.controller.ts`, `src/app.module.ts`
**Depends on**: None
**Reuses**: NestJS controller pattern
**Requirement**: API-04

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when**:

- [x] `GET /health` returns 200.
- [x] Controller has no external dependency checks.
- [x] Gate check passes: `npm test` or `npm run test:e2e`

**Tests**: unit or e2e
**Gate**: quick / full

---

### T9: Wire adapter selection in module

**What**: Provide `CATALOG_CLIENT` via factory: use `HttpCatalogClient` when `CATALOG_BASE_URL` is set, otherwise `InMemoryCatalogClient`.
**Where**: `src/processing-requests/processing-requests.module.ts`
**Depends on**: T4, T8
**Reuses**: existing module pattern
**Requirement**: API-02, API-04

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when**:

- [x] Module reads `process.env.CATALOG_BASE_URL`.
- [x] Unit/e2e tests still use the in-memory path when env is unset.
- [x] Gate check passes: `npm test && npm run test:e2e`

**Tests**: e2e
**Gate**: full

---

### T10: Add API Dockerfile

**What**: Create a multi-stage Dockerfile and `.dockerignore` for the API.
**Where**: `Dockerfile`, `.dockerignore`
**Depends on**: None
**Reuses**: standard Node image
**Requirement**: API-01

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when**:

- [x] `docker build . -t fiapx-api:local` succeeds.
- [x] Image exposes port 3000 and runs `node dist/main`.
- [x] Build context excludes `node_modules`, `dist`, `.git`, `.specs`, tests.

**Tests**: none
**Gate**: docker

---

### T11: Add `compose.yaml`

**What**: Define local services (api, catalog, worker, notification, rabbitmq) with deterministic ports and health checks.
**Where**: `compose.yaml`
**Depends on**: T10
**Reuses**: Docker Compose syntax
**Requirement**: API-01

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when**:

- [x] `api` builds from repo root and depends on healthy `catalog` and `rabbitmq`.
- [x] Sibling services build from `../processing-catalog`, `../processing-worker`, `../notification-service`.
- [x] RabbitMQ service has a health check.
- [x] API environment sets `CATALOG_BASE_URL=http://catalog:3001`.

**Tests**: none
**Gate**: docker

---

### T12: Add smoke script

**What**: Create `scripts/smoke-local-integration.mjs` that posts through API and polls Catalog/Notification observations.
**Where**: `scripts/smoke-local-integration.mjs`
**Depends on**: T8, T9, T11
**Reuses**: Node built-in `fetch`
**Requirement**: API-05

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when**:

- [x] Script waits for API health.
- [x] Script posts to `/processing-requests` and captures `processingRequestId`.
- [x] Script polls Catalog request-state endpoint until `COMPLETED`.
- [x] Script polls Notification delivery endpoint until a record exists.
- [x] Script exits non-zero on timeout or failure.

**Tests**: smoke
**Gate**: smoke

---

### T13: Run build, lint, unit, e2e, Docker, and smoke gates

**What**: Execute all gates to close the feature.
**Where**: `package.json`, `Dockerfile`, `compose.yaml`, `scripts/smoke-local-integration.mjs`
**Depends on**: T6, T7, T9, T11, T12
**Reuses**: existing npm scripts, Docker, Node
**Requirement**: FSS-02

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when**:

- [x] `npm run build` passes.
- [x] `npm run lint` passes with no new warnings.
- [x] `npm test` passes.
- [x] `npm run test:e2e` passes.
- [x] `docker compose up --build --wait` starts all services.
- [x] `node scripts/smoke-local-integration.mjs` exits 0.

**Tests**: all
**Gate**: smoke

---

## Phase Execution Map

```text
T1 -> T3
T1 -> T4
T2 -> T5
T3 -> T5
T4 -> T5
T4 -> T9
T5 -> T6
T6 -> T13
T7 -> T13
T8 -> T9
T8 -> T12
T9 -> T12
T9 -> T13
T10 -> T11
T11 -> T12
T11 -> T13
T12 -> T13
```

Phases run in order; tasks within a phase run in order. Cross-phase dependencies are shown because the dependency diagram and task definitions must stay consistent.

---

## Task Granularity Check

| Task | Scope | Status |
| --- | --- | --- |
| T1: Extend port return type | 1 interface | ✅ Granular |
| T2: Update response DTO | 1 DTO | ✅ Granular |
| T3: Update in-memory stub | 1 adapter | ✅ Granular |
| T4: Implement HTTP Catalog adapter | 1 adapter | ✅ Granular |
| T5: Narrow service error mapping | 1 service | ✅ Granular |
| T6: Fix service unit test assertion | 1 test file | ✅ Granular |
| T7: Fix e2e TypeScript type error | 1 test line | ✅ Granular |
| T8: Add `/health` endpoint | 1 controller + module registration | ✅ Granular |
| T9: Wire adapter selection | 1 module provider | ✅ Granular |
| T10: Add Dockerfile | 1 Dockerfile + ignore | ✅ Granular |
| T11: Add compose.yaml | 1 compose file | ✅ Granular |
| T12: Add smoke script | 1 script | ✅ Granular |
| T13: Run all gates | 1 gate task | ✅ Granular |

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| --- | --- | --- | --- |
| T1 | None | none | ✅ Match |
| T2 | None | none | ✅ Match |
| T3 | T1 | T1 -> T3 | ✅ Match |
| T4 | T1 | T1 -> T4 | ✅ Match |
| T5 | T2, T3, T4 | T2 -> T5, T3 -> T5, T4 -> T5 | ✅ Match |
| T6 | T5 | T5 -> T6 | ✅ Match |
| T7 | None | none | ✅ Match |
| T8 | None | none | ✅ Match |
| T9 | T4, T8 | T4 -> T9, T8 -> T9 | ✅ Match |
| T10 | None | none | ✅ Match |
| T11 | T10 | T10 -> T11 | ✅ Match |
| T12 | T8, T9, T11 | T8 -> T12, T9 -> T12, T11 -> T12 | ✅ Match |
| T13 | T6, T7, T9, T11, T12 | T6 -> T13, T7 -> T13, T9 -> T13, T11 -> T13, T12 -> T13 | ✅ Match |

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| --- | --- | --- | --- | --- |
| T1 | Port/interface | none | none | ✅ OK |
| T2 | DTO (response) | unit | unit | ✅ OK |
| T3 | Stub adapter | unit | unit | ✅ OK |
| T4 | HTTP adapter | unit | unit | ✅ OK |
| T5 | Service error handling | unit | unit | ✅ OK |
| T6 | Service test | unit | unit | ✅ OK |
| T7 | e2e test | e2e | e2e | ✅ OK |
| T8 | Health controller | unit or e2e | unit or e2e | ✅ OK |
| T9 | Module wiring | e2e | e2e | ✅ OK |
| T10 | Dockerfile | docker build | docker build | ✅ OK |
| T11 | Compose | compose up | compose up | ✅ OK |
| T12 | Smoke script | smoke test | smoke test | ✅ OK |
| T13 | Gate task | all gates | all gates | ✅ OK |
