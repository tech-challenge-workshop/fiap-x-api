# Auth and Owner Scope Tasks — api

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.** (In this project's sessions the skill is not registered by name; the user has authorized reading it from `.agents/skills/tlc-spec-driven/` by path.)

---

**Design**: `.specs/features/auth-owner-scope/design.md`
**Status**: Draft

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec - confirm before Execute. Guidelines found: none - strong defaults applied (no `AGENTS.md`, `CONTRIBUTING.md` or coverage threshold). Samples: `src/**/*.spec.ts` (unit), `test/processing-requests.e2e-spec.ts` (e2e through `AppModule` with the in-memory Catalog client and the global `ValidationPipe` re-applied). Commands from `package.json` and `.github/workflows/ci.yml`. `ts-jest` does not type-check, so `typecheck` is in the Build gate.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| Auth primitives (config, key cache, verifier) | unit | All branches; real RS256 keys generated with `jose` and a key set served by a local HTTP server — never a mocked verifier; every error class in the design's Error Handling table | `src/auth/*.spec.ts` | `npm test` |
| Guard + module wiring | e2e | Every P1 AC through `AppModule` over HTTP: each 401 cause, 503, `/health` public, Catalog client never called on rejection | `test/*.e2e-spec.ts` | `npm run test:e2e` |
| Catalog client adapters | unit | New calls: success, 404, non-OK, network failure, malformed body | `src/processing-requests/adapters/*.spec.ts` | `npm test` |
| Projection | unit | Allow-list: every exposed field, every forbidden field absent, `failureReason` iff `FAILED` | `src/processing-requests/*.spec.ts` | `npm test` |
| Controllers + services | e2e | Every route: happy path, every listed edge case, every error path (400/401/404/502) | `test/*.e2e-spec.ts` | `npm run test:e2e` |
| Dependencies / Jest config | none | Build gate only | `package.json`, `test/jest-e2e.json` | build gate |

## Gate Check Commands

> Generated from codebase - confirm before Execute.

| Gate Level | When to Use | Command |
| --- | --- | --- |
| Quick | Unit-only tasks | `npm test` |
| Full | Tasks with e2e tests | `npm test && npm run test:e2e` |
| Build | Last task of a phase, config tasks | `npm run lint && npm run typecheck && npm test && npm run test:e2e && npm run build` |

---

## Execution Plan

### Phase 1: Authentication foundation

```
T1 -> T2
T1 -> T3
T3 -> T4
T2 -> T5
T4 -> T5
```

### Phase 2: Owner-scoped endpoints

```
T6 -> T9
T7 -> T9
T6 -> T10
T7 -> T10
T8
```

### Phase 3: Outage semantics end to end

```
T11
T12
```

---

## Task Breakdown

### Phase 1: Authentication foundation

### T1: Add `jose` and let Jest load it

**What**: Add `jose@6.2.12` (exact) and configure both Jest configs to transform it (it is ESM-only), as `processing-worker` did for `archiver@8`.
**Where**: `package.json`
**Depends on**: None
**Reuses**: `processing-worker`'s `transformIgnorePatterns` approach
**Requirement**: AUTH-01

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [x] `jose` pinned exactly; `test/jest-e2e.json` and the root Jest config transform it
- [x] A unit test and an e2e test can `import { jwtVerify } from 'jose'` (proved by the first test in T3)
- [x] The built app loads it: `node -e "require('./dist/main')"`-style check or requiring the built module that imports it
- [x] Build gate passes

**Tests**: none
**Gate**: build
**Status**: ✅ Complete. A throwaway probe (not committed) imported `jose` under both Jest configs, passed `typecheck` and `build`, and the built module loaded with `require()` in Node 22. The permanent proof is T3's suite and T5's e2e suites.

---

### T2: Load and require the OIDC configuration

**What**: `loadOidcConfig(env)` returning issuer, audience, key-set URL and timeout (default 2000), throwing and naming the variable when one is missing or blank.
**Where**: `src/auth/oidc.config.ts`
**Depends on**: T1
**Reuses**: Nothing
**Requirement**: AUTH-01

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Each of `OIDC_ISSUER`, `OIDC_AUDIENCE`, `OIDC_JWKS_URL` missing → an error naming it; blank counts as missing
- [x] `OIDC_JWKS_TIMEOUT_MS` defaults to 2000; a non-positive or non-numeric value → error naming it
- [x] Quick gate passes; at least 6 new tests

**Tests**: unit
**Gate**: quick
**Status**: ✅ Complete. 11 new unit tests in `src/auth/oidc.config.spec.ts` (unit 18 → 29).

---

### T3: Cache signing keys without expiry and refetch on an unknown `kid`

**What**: `SigningKeyCache.keyFor(header)`: resolves from the cached set; an unknown `kid` triggers one refetch (shared by concurrent callers); a failed or timed-out fetch throws `IdentityProviderUnavailableError`; a `kid` still absent after a successful refetch throws `JWKSNoMatchingKey`.
**Where**: `src/auth/signing-key-cache.ts`
**Depends on**: T1
**Reuses**: `jose.createLocalJWKSet`
**Requirement**: AUTH-02, AUTH-03

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Tested against a key set served by a local `node:http` server: first use fetches; a cached `kid` resolves with the server stopped (AC P1.8); an unknown `kid` with the server stopped → `IdentityProviderUnavailableError` (AC P1.7); an unknown `kid` with the server up and still missing → `JWKSNoMatchingKey`; a rotated key is picked up after one refetch
- [x] Two concurrent misses cause exactly one fetch
- [x] A hanging server exceeds the timeout → `IdentityProviderUnavailableError`
- [x] Quick gate passes; at least 7 new tests

**Tests**: unit
**Gate**: quick
**Status**: ✅ Complete. 11 new unit tests (unit 29 → 40). The key-set server helper lives in `test/support/jwks-server.ts` for reuse by T5 and T11. The error class is `src/auth/identity-provider-unavailable.error.ts`.

---

### T4: Verify a token and return only its `sub`

**What**: `TokenVerifier.verify(token)` using `jwtVerify(token, cache.keyFor, { issuer, audience, algorithms: ['RS256'] })`, returning `{ sub }` and rejecting a payload without a string `sub`.
**Where**: `src/auth/token-verifier.ts`
**Depends on**: T3
**Reuses**: `SigningKeyCache`
**Requirement**: AUTH-01, AUTH-02

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Real signed tokens: valid → `{ sub }` and nothing else; expired, wrong `iss`, wrong `aud`, tampered payload, `alg` other than RS256, no `sub`, non-string `sub` → each rejected with the class the guard maps to 401
- [x] Quick gate passes; at least 8 new tests

**Tests**: unit
**Gate**: quick
**Status**: ✅ Complete. 14 new unit tests (unit 40 → 54). Every 401 cause is a `jose` `JOSEError`: `JWTExpired`, `JWTClaimValidationFailed`, `JWSSignatureVerificationFailed`, `JOSEAlgNotAllowed`, `JWSInvalid`. A missing, empty or non-string `sub` raises `JWTClaimValidationFailed` with claim `sub`. `IdentityProviderUnavailableError` propagates unchanged for the 503. Token helper: `test/support/tokens.ts`. Spec-precision gap: a token with no `exp` is not rejected, because the spec only covers expired tokens (Keycloak always sets `exp`).

---

### T5: Guard every route by default and expose the owner

**What**: `JwtAuthGuard` registered as `APP_GUARD` in `AuthModule`, `@Public()` on `HealthController`, `@Owner()` param decorator; 401 for every authentication failure, 503 for `IdentityProviderUnavailableError`; nothing about the token logged.
**Where**: `src/auth/jwt-auth.guard.ts`
**Depends on**: T2, T4
**Reuses**: `TokenVerifier`, `loadOidcConfig`
**Requirement**: AUTH-01, AUTH-02, AUTH-03

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [x] e2e through `AppModule` with a local key-set server: no header, `Basic` scheme, expired, tampered, wrong `iss`, wrong `aud`, no `sub` → 401 and the in-memory Catalog client records zero calls
- [x] `/health` answers without a token
- [x] A composition e2e: `AppModule` refuses to boot when each OIDC variable is missing, and the guard is the registered `APP_GUARD`
- [x] Existing e2e suites send a valid token and still pass (tests updated to authenticate; no assertion weakened)
- [x] Build gate passes

**Tests**: e2e
**Gate**: build
**Status**: ✅ Complete. e2e 6 → 24, unit unchanged at 54.
- New suites: `test/auth.e2e-spec.ts` (14 tests) and `test/auth-composition.e2e-spec.ts` (4 tests).
- `test/auth.e2e-spec.ts` also covers a key the provider does not publish, the 503 when the provider is down with nothing cached, and a check that a non-public route is protected.
- `test/app.e2e-spec.ts` and `test/processing-requests.e2e-spec.ts` now start `TestIdentityProvider` and send a bearer token; they gained lines only.
- Shared helpers: `test/support/test-identity-provider.ts` (key-set server, OIDC env, tokens) and `test/support/catalog-calls.ts` (counts calls on every Catalog client method).
- Deviation: `test/jest-e2e.json` gained `testPathIgnorePatterns` for AppleDouble `._*` files, matching the unit config. Without it, e2e runs on the exFAT volume pick up phantom suites.

---

### Phase 2: Owner-scoped endpoints

### T6: Extend the Catalog client with the owner-scoped reads

**What**: `listOwned(owner, page, pageSize)` and `getOwned(owner, id)` on the port, `HttpCatalogClient` (calling `/owners/:owner/processing-requests[/:id]`, `undefined` on 404, `CatalogUnavailableError` otherwise) and `InMemoryCatalogClient` (owner-filtered, newest first).
**Where**: `src/processing-requests/ports/catalog-client.port.ts`
**Depends on**: None
**Reuses**: `HttpCatalogClient`'s fetch-and-validate shape
**Requirement**: AUTH-05, AUTH-08

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [x] HTTP adapter tests (local server): success, 404 → `undefined`, 500, network failure, malformed body → `CatalogUnavailableError`; the owner is URL-encoded in the path
- [x] In-memory adapter: two owners never see each other's items
- [x] Quick gate passes; at least 8 new tests

**Tests**: unit
**Gate**: quick
**Status**: ✅ Complete. 21 new unit tests (unit 54 → 75).
- HTTP adapter against a local `node:http` server: exact path and query asserted, owner and id URL-encoded, 404 → `undefined` on `getOwned` only. A 404 on the list, any other non-200, a non-JSON body, a wrong shape and an unreachable Catalog each → `CatalogUnavailableError`.
- In-memory adapter stores what it creates and filters by owner, newest first by creation order. Its reads return the whole record, `ownerUserId` and `sourceStorageKey` included, so the e2e suites prove the API's projection rather than the double's discretion. Its reject switch now applies to the reads too.
- Adequacy: every Done-when item maps to `http-catalog-client.adapter.spec.ts:148-149,159,185,193,208-209,221,244,255` and `in-memory-catalog-client.adapter.spec.ts:39-59`; no test without a criterion.

---

### T7: Project Catalog items onto the user contract

**What**: `projectForOwner(item)` copying the allow-list and `failureReason` only for `FAILED`.
**Where**: `src/processing-requests/projection.ts`
**Depends on**: None
**Reuses**: Nothing
**Requirement**: AUTH-09

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Given an item carrying every forbidden field (`sourceStorageKey`, `zipStorageKey`, `failureCode`, `attemptId`, `ownerUserId`, an unknown future field), none survives
- [x] `failureReason` present for `FAILED`, absent for every other status even when the input carries one
- [x] Quick gate passes; at least 4 new tests

**Tests**: unit
**Gate**: quick
**Status**: ✅ Complete. 5 new unit tests in `src/processing-requests/projection.spec.ts` (unit 75 → 80). Every input carries all five forbidden fields, an unknown `someFutureField` and a `failureReason`; the output is compared with `toStrictEqual` (`:26`, `:38`) and its key set (`:39`), so a delete-list implementation fails on the unknown field. `OwnedItem` and `OwnedPage` live beside the function.

---

### T8: Create requests as the token's owner

**What**: The create route takes `@Owner()`; `CreateProcessingRequestDto.ownerUserId` becomes optional and unread; the response is `{ processingRequestId, status }`.
**Where**: `src/processing-requests/controllers/processing-requests.controller.ts` (replaces `create-processing-request.controller.ts`)
**Depends on**: None
**Reuses**: `CreateProcessingRequestService`, `CatalogErrorFilter`
**Requirement**: AUTH-04

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [x] e2e: as `alice` with `ownerUserId: "bob"` in the body → 201 and the Catalog client receives `alice`'s `sub`; without the field → 201
- [x] The response has no `sourceStorageKey`; `sourceStorageKey` still required (400 when missing)
- [x] Catalog unavailable → 502 (existing behaviour kept)
- [x] Full gate passes

**Tests**: e2e
**Gate**: full
**Status**: ✅ Complete. e2e 24 → 25, unit unchanged at 80.
- `ProcessingRequestsController` replaces `CreateProcessingRequestController`; `create` passes `@Owner()` to `CreateProcessingRequestService.execute(owner, dto)`, which returns only `{ processingRequestId, status }`.
- That projection matters: the real Catalog's creation response also carries `ownerUserId`, `sourceStorageKey` and `createdAt`, and the old code returned it whole. The in-memory client now returns the same whole record, so `test/processing-requests.e2e-spec.ts:84` (`toEqual({ processingRequestId, status: 'RECEIVED' })`) fails if the API passes it through.
- Evidence: `:82` the Catalog client receives `'alice'` for a body naming `bob`; `:89-92` the request is listed under `alice` and `bob` has none; `:63-70` no `ownerUserId` → 201; `:95-102` no `sourceStorageKey` → 400; `:113-123` → 502.
- Tests whose assertions encoded the superseded contract (owner from the body) were rewritten to the new one, with no count change: `create-processing-request.dto.spec.ts` (missing and empty `ownerUserId` now accepted; an empty body names only `sourceStorageKey`), `create-processing-request.service.spec.ts` (the owner is the first argument; it asserts `'alice'` reaches the client, not the body's `'user-123'`), and `test/processing-requests.e2e-spec.ts` (`returns 400 when ownerUserId is missing` became `returns 201 ...`, the Done-when above; the id now contains `alice`, not `user-123`).

---

### T9: List the caller's requests

**What**: `GET /processing-requests` with `ListQueryDto` (`page` ≥ 1 default 1, `pageSize` 1–100 default 20) and `ListOwnProcessingRequestsService` (`listOwned` then `projectForOwner`).
**Where**: `src/processing-requests/services/list-own-processing-requests.service.ts`
**Depends on**: T6, T7
**Reuses**: The controller from T8
**Requirement**: AUTH-05, AUTH-06, AUTH-07, AUTH-09

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [x] e2e: `alice`'s and `bob`'s lists disjoint; defaults applied; `{ items, page, pageSize, total }`; page beyond the end → `items: []` with the true `total`; a user with none → `total: 0`
- [x] `page=0`, `page=abc`, `pageSize=0`, `pageSize=101` → 400 naming the parameter and range, Catalog not called
- [x] No forbidden field in any item; Catalog failure → 502
- [x] Full gate passes

**Tests**: e2e
**Gate**: full
**Status**: ✅ Complete. 18 new e2e tests in `test/list-processing-requests.e2e-spec.ts` (e2e 25 → 43), unit unchanged at 80.
- Requests are created over HTTP with `alice`'s and `bob`'s tokens. `:92-95` each list holds only the caller's ids, newest first, with `total` equal to their count; `:102-103` the Catalog is asked with the defaults `(owner, 1, 20)`. `:113` explicit paging, `:128` beyond the end → `items: []` with the true `total`, `:136` a user with none → `{ items: [], page: 1, pageSize: 20, total: 0 }`.
- `:145` an item's keys are exactly `createdAt`, `processingRequestId`, `status`, `updatedAt`, although the in-memory Catalog returns `ownerUserId` and `sourceStorageKey` too; `:166` none of the forbidden names nor the storage key appears in the body.
- `:188-189` ten invalid queries (0, negative, `abc`, `1.5`, empty, repeated, 101, both at once) → `{ statusCode: 400, message: [<exact Catalog wording>] }` with zero Catalog calls. `:205` → 502, `:218-219` no token → 401 with zero Catalog calls.
- `ListQueryDto` converts only digit strings and checks the range in one constraint, so each invalid parameter yields exactly one message, worded as the Catalog words it.
- Deviation: `CatalogErrorFilter` now takes the message from the exception's response body for every status. Before, a validation `400` on these routes answered `message: "Bad Request Exception"`, hiding which parameter failed (AC P3.7, P3.8). The `502` branch is gone, so a Catalog failure answers `message: "Catalog unavailable"` on every route; it used to say `"Catalog rejected creation"`, which is wrong for a read. The 401 and 503 bodies are unchanged.

---

### T10: Read one of the caller's requests

**What**: `GET /processing-requests/:id` with `GetOwnProcessingRequestService` (`getOwned` then `projectForOwner`, `NotFoundException` with one constant body on `undefined`).
**Where**: `src/processing-requests/services/get-own-processing-request.service.ts`
**Depends on**: T6, T7
**Reuses**: The controller from T8
**Requirement**: AUTH-08, AUTH-09

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [x] e2e: the owner gets 200 with the projected item; another user, a random UUID and a malformed id get byte-identical 404 bodies; Catalog failure → 502
- [x] Build gate passes

**Tests**: e2e
**Gate**: build
**Status**: ✅ Complete. 4 new e2e tests in `test/get-processing-request.e2e-spec.ts` (e2e 43 → 47), unit unchanged at 80. Build gate green (lint, typecheck, unit, e2e, build).
- `:69-76` the owner gets exactly `processingRequestId`, `status`, `createdAt`, `updatedAt`, while the in-memory Catalog returns `ownerUserId` and `sourceStorageKey` as well; `:81` no value is the storage key.
- `:95-103` `bob` reading `alice`'s id, a random UUID and `not-a-uuid` get `{ statusCode: 404, message: "Processing request not found" }` with identical response text and content type; `:104` the Catalog was asked under `bob`, so scoping happens in the query, not after it.
- `:113` → 502 `Catalog unavailable`; `:126-127` no token → 401 with zero Catalog calls.

---

### Phase 3: Outage semantics end to end

### T11: Prove the provider-outage behaviour through the running app

**What**: An e2e suite that boots `AppModule` against a local key-set server, authenticates once, stops the server, and asserts the design's outage semantics over HTTP.
**Where**: `test/auth-outage.e2e-spec.ts`
**Depends on**: None
**Reuses**: The key-set server helper from T3/T5
**Requirement**: AUTH-03

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [x] With the server stopped: a token signed by the already-used key → 200 (AC P1.8); a token signed by a new key → 503 `Authentication temporarily unavailable` (AC P1.7), Catalog not called
- [x] With the server back and serving the new key: that token → 200
- [x] Verified negatively in a scratch copy: swapping `SigningKeyCache` for `createRemoteJWKSet` makes the 503 assertion fail
- [x] Build gate passes

**Tests**: e2e
**Gate**: build
**Status**: ✅ Complete. 3 new e2e tests in `test/auth-outage.e2e-spec.ts` (e2e 47 → 50), unit unchanged at 80. Build gate green.
- Each test boots a fresh `AppModule`, authenticates once over `GET /processing-requests` so the key is cached, then stops the key-set server. `:73-76` a new token from the cached key → 200 and the Catalog is asked for `bob`; `:83-89` a token from a key never fetched → 503 with the exact body and zero Catalog calls; `:95-104` after the server restarts serving both keys, the same token → 200 for `carol`.
- Negative check, in a scratch copy outside the repository (removed afterwards; the real tree was not edited and `git stash` was not used): `SigningKeyCache.keyFor` delegating to `createRemoteJWKSet(new URL(jwksUrl), { timeoutDuration })`. Result: 2 of 3 tests failed, both with `expected 503 "Service Unavailable", got 401 "Unauthorized"`. `jose`'s cooldown skips the refetch that would reveal the outage, as the design's spike predicted. The cached-key test still passed, as expected within `jose`'s cache window.

---

### T12: Reject a token without `exp`

**What**: Require `exp` (and `sub`) through `jwtVerify`'s `requiredClaims`, so a token that never expires is refused.
**Where**: `src/auth/token-verifier.ts`
**Depends on**: None
**Reuses**: T4's verifier and its token helpers
**Requirement**: AUTH-01 (spec edge case added during Execute)

**Why**: Added by the orchestrator after T4 recorded that a token without `exp` is accepted. AD-005 names `exp` among the claims the guard relies on; accepting its absence makes a leaked token valid forever.

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [x] A validly signed token without `exp` is rejected with the class the guard maps to 401 (unit), and gets 401 over HTTP with the Catalog not called (e2e)
- [x] Every existing token test still passes
- [x] Build gate passes

**Tests**: e2e
**Gate**: build
**Status**: ✅ Complete. unit 80 → 81, e2e 50 → 51. Build gate green.
- `TokenVerifier` passes `requiredClaims: ['exp', 'sub']` to `jwtVerify`.
- Unit, `src/auth/token-verifier.spec.ts:137-139`: the token really has no `exp` (`decodeJwt`), and verification fails with `errors.JWTClaimValidationFailed` (asserted in `claimFailure`, `:45`) on claim `exp`.
- e2e, `test/auth.e2e-spec.ts:125`: a new row in the 401 table, so `:131-133` assert 401, the `{ statusCode: 401, message: "Unauthorized" }` body and zero Catalog calls. All 14 other verifier tests and all other 401 rows pass unchanged.

---

## Phase Execution Map

```
Phase 1 (T1 T2 T3 T4 T5) then Phase 2 (T6 T7 T8 T9 T10) then Phase 3 (T11 T12)
```

11 tasks pack into two batches at ~7 per worker, cutting on phase boundaries: **Phase 1** (5) and **Phases 2 + 3** (6). Cross-repository order for S5: `processing-catalog` first (this repository's `HttpCatalogClient` calls its new routes), then this repository, then `fiap-x-platform`.

---

## Task Granularity Check

| Task | Scope | Status |
| --- | --- | --- |
| T1: `jose` + Jest config | 1 dependency + its test config | ✅ Granular |
| T2: OIDC config | 1 function | ✅ Granular |
| T3: Signing-key cache | 1 class | ✅ Granular |
| T4: Token verifier | 1 class | ✅ Granular |
| T5: Guard + decorators + registration | 1 guard with its two decorators and module | ⚠️ OK - cohesive; the guard is untestable unregistered |
| T6: Catalog client reads | 1 port + 2 adapters | ⚠️ OK - cohesive; one contract, its two implementations |
| T7: Projection | 1 function | ✅ Granular |
| T8: Create as owner | 1 route + DTO change | ✅ Granular |
| T9: List route | 1 route + service + query DTO | ⚠️ OK - cohesive; one endpoint |
| T10: Get route | 1 route + service | ✅ Granular |
| T11: Outage e2e | 1 test file | ✅ Granular |
| T12: Require `exp` | 1 option on the verifier | ✅ Granular |

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows (within phase) | Status |
| --- | --- | --- | --- |
| T1 | None | — | ✅ Match |
| T2 | T1 | T1 → T2 | ✅ Match |
| T3 | T1 | T1 → T3 | ✅ Match |
| T4 | T3 | T3 → T4 | ✅ Match |
| T5 | T2, T4 | T2 → T5, T4 → T5 | ✅ Match |
| T6 | None | — | ✅ Match |
| T7 | None | — | ✅ Match |
| T8 | None | — | ✅ Match |
| T9 | T6, T7 | T6 → T9, T7 → T9 | ✅ Match |
| T10 | T6, T7 | T6 → T10, T7 → T10 | ✅ Match |
| T11 | None | — | ✅ Match |
| T12 | None | — | ✅ Match |

No task depends on a later phase. Phase 2 and 3 tasks rely on Phase 1 having completed (the guard provides `@Owner()`), which phase ordering guarantees.

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| --- | --- | --- | --- | --- |
| T1 | Dependencies / Jest config | none | none | ✅ OK |
| T2 | Auth primitives | unit | unit | ✅ OK |
| T3 | Auth primitives | unit | unit | ✅ OK |
| T4 | Auth primitives | unit | unit | ✅ OK |
| T5 | Guard + module wiring | e2e | e2e | ✅ OK |
| T6 | Catalog client adapters | unit | unit | ✅ OK |
| T7 | Projection | unit | unit | ✅ OK |
| T8 | Controllers + services | e2e | e2e | ✅ OK |
| T9 | Controllers + services | e2e | e2e | ✅ OK |
| T10 | Controllers + services | e2e | e2e | ✅ OK |
| T11 | Guard + module wiring | e2e | e2e | ✅ OK |
| T12 | Auth primitives + guard | e2e | e2e | ✅ OK |

T1 is the only `Tests: none`, on a layer the matrix marks `none`; its correctness is proved by T3's first test importing `jose` under Jest and by the build gate loading the built module.
