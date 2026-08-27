# API Initial Vertical Slice Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: `.specs/features/initial-vertical-slice/design.md`
**Status**: Draft

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec. Guidelines found: `package.json` (jest config, lint/build scripts), `README.md`, service boundary doc.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| DTO (validation) | unit | All validation rules; happy + missing field paths | `src/**/*.spec.ts` | `npm test` |
| Port/interface | none | Build gate only | - | build gate only |
| Stub adapter | unit | Happy path and rejection path | `src/**/*.spec.ts` | `npm test` |
| Service (domain logic) | unit | 1:1 to spec ACs; valid input, missing fields, Catalog rejection | `src/**/*.spec.ts` | `npm test` |
| Controller | e2e | POST route happy path + validation error + Catalog rejection | `test/*.e2e-spec.ts` | `npm run test:e2e` |
| Bootstrap config | none | Build gate only | - | build gate only |
| Build gate | none | TypeScript build + ESLint pass | - | `npm run build && npm run lint` |

## Gate Check Commands

> Generated from codebase.

| Gate Level | When to Use | Command |
| --- | --- | --- |
| Quick | After tasks with unit tests only | `npm test` |
| Full | After tasks with e2e/integration tests | `npm test && npm run test:e2e` |
| Build | After phase completion or config/entity-only tasks | `npm run build && npm run lint` |

---

## Execution Plan

Phases are ordered and run sequentially; tasks within a phase execute in order.

### Phase 1: DTOs and Port

Run in order: T1, T2, T3.

### Phase 2: Adapter and Service

Run in order: T4, T5.

### Phase 3: HTTP Boundary and Validation

Run in order: T7, T6.

### Phase 4: Build Gate

Run in order: T8.

---

## Task Breakdown

### T1: Create request DTO with validation rules

**What**: Define the `CreateProcessingRequestDto` class with `class-validator` decorators for `ownerUserId` and `sourceStorageKey`.
**Where**: `src/processing-requests/dtos/create-processing-request.dto.ts`
**Depends on**: None
**Reuses**: NestJS DTO pattern
**Requirement**: API-01, API-03

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when**:

- [x] DTO exists with both fields and non-empty string validation.
- [x] Unit tests exercise valid input and missing-field errors.
- [x] Gate check passes: `npm test`

**Tests**: unit
**Gate**: quick

---

### T2: Create response DTO

**What**: Define the `CreateProcessingRequestResponseDto` class with `processingRequestId`.
**Where**: `src/processing-requests/dtos/create-processing-request-response.dto.ts`
**Depends on**: None
**Reuses**: NestJS DTO pattern
**Requirement**: API-02

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when**:

- [x] DTO exists and is exported.
- [x] No TypeScript errors.
- [x] Gate check passes: `npm run build`

**Tests**: none
**Gate**: build

---

### T3: Define CatalogClient port

**What**: Create the `CatalogClient` interface with a `createProcessingRequest` method.
**Where**: `src/processing-requests/ports/catalog-client.port.ts`
**Depends on**: None
**Reuses**: Port/adapter pattern
**Requirement**: API-01

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when**:

- [x] Interface defines the creation boundary.
- [x] No TypeScript errors.
- [x] Gate check passes: `npm run build`

**Tests**: none
**Gate**: build

---

### T4: Implement InMemoryCatalogClient stub

**What**: Create an in-memory adapter that implements `CatalogClient` and returns deterministic IDs or a rejection.
**Where**: `src/processing-requests/adapters/in-memory-catalog-client.adapter.ts`
**Depends on**: T3
**Reuses**: Port/adapter pattern
**Requirement**: API-01, API-04

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when**:

- [x] Adapter implements `CatalogClient`.
- [x] Unit tests cover success and rejection paths.
- [x] Gate check passes: `npm test`

**Tests**: unit
**Gate**: quick

---

### T5: Implement CreateProcessingRequestService

**What**: Create the service that validates input presence and delegates to `CatalogClient`.
**Where**: `src/processing-requests/services/create-processing-request.service.ts`
**Depends on**: T3, T4
**Reuses**: NestJS service pattern
**Requirement**: API-01, API-02, API-03, API-04

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when**:

- [ ] Service calls the Catalog port with the owner and source key.
- [ ] Service returns a response DTO with the Catalog-provided ID.
- [ ] Service does not change or expose processing status.
- [ ] Unit tests cover valid request, Catalog rejection, and adapter errors.
- [ ] Gate check passes: `npm test`

**Tests**: unit
**Gate**: quick

---

### T6: Implement CreateProcessingRequestController with e2e tests

**What**: Add the `POST /processing-requests` endpoint and co-located e2e tests.
**Where**: `src/processing-requests/controllers/create-processing-request.controller.ts`
**Depends on**: T2, T5, T7
**Reuses**: NestJS controller pattern
**Requirement**: API-01, API-02, API-03, API-04

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when**:

- [ ] Controller accepts `CreateProcessingRequestDto` and returns `CreateProcessingRequestResponseDto`.
- [ ] Controller has no processing-state transition logic.
- [ ] E2E tests cover happy path, validation errors, and Catalog rejection.
- [ ] Gate check passes: `npm test && npm run test:e2e`

**Tests**: e2e
**Gate**: full

---

### T7: Enable global ValidationPipe in bootstrap

**What**: Register the built-in `ValidationPipe` in `src/main.ts` so DTO validation is applied to all routes.
**Where**: `src/main.ts`
**Depends on**: T1
**Reuses**: NestJS bootstrap configuration
**Requirement**: API-03

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when**:

- [ ] `ValidationPipe` is enabled globally with `whitelist: true` and sensible defaults.
- [ ] No TypeScript errors.
- [ ] Gate check passes: `npm run build`

**Tests**: none
**Gate**: build

---

### T8: Run lint and build gates

**What**: Execute the repository-wide lint and build commands to close the feature.
**Where**: `package.json`
**Depends on**: T6
**Reuses**: Existing npm scripts
**Requirement**: FSS-02

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when**:

- [ ] `npm run lint` passes with no new warnings.
- [ ] `npm run build` compiles the project successfully.
- [ ] Gate check passes: `npm run build && npm run lint`

**Tests**: none
**Gate**: build

---

## Phase Execution Map

```text
T3 -> T4
T3 -> T5
T4 -> T5
T1 -> T7
T2 -> T6
T5 -> T6
T7 -> T6
T6 -> T8
```

Phases run in order; tasks within a phase run in order. Cross-phase dependencies are shown because the dependency diagram and task definitions must stay consistent.

---

## Task Granularity Check

| Task | Scope | Status |
| --- | --- | --- |
| T1: Create request DTO with validation rules | 1 DTO | ✅ Granular |
| T2: Create response DTO | 1 DTO | ✅ Granular |
| T3: Define CatalogClient port | 1 interface | ✅ Granular |
| T4: Implement InMemoryCatalogClient stub | 1 adapter | ✅ Granular |
| T5: Implement CreateProcessingRequestService | 1 service | ✅ Granular |
| T6: Implement controller with e2e tests | 1 controller + e2e | ✅ Granular |
| T7: Enable global ValidationPipe | 1 config change | ✅ Granular |
| T8: Run lint and build gates | 1 gate task | ✅ Granular |

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| --- | --- | --- | --- |
| T1 | None | none | ✅ Match |
| T2 | None | none | ✅ Match |
| T3 | None | none | ✅ Match |
| T4 | T3 | T3 -> T4 | ✅ Match |
| T5 | T3, T4 | T3 -> T5, T4 -> T5 | ✅ Match |
| T6 | T2, T5, T7 | T2 -> T6, T5 -> T6, T7 -> T6 | ✅ Match |
| T7 | T1 | T1 -> T7 | ✅ Match |
| T8 | T6 | T6 -> T8 | ✅ Match |

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| --- | --- | --- | --- | --- |
| T1 | DTO (validation) | unit | unit | ✅ OK |
| T2 | DTO | none | none | ✅ OK |
| T3 | Port/interface | none | none | ✅ OK |
| T4 | Stub adapter | unit | unit | ✅ OK |
| T5 | Service (domain logic) | unit | unit | ✅ OK |
| T6 | Controller | e2e | e2e | ✅ OK |
| T7 | Bootstrap config | none | none | ✅ OK |
| T8 | Build gate | none | none | ✅ OK |
