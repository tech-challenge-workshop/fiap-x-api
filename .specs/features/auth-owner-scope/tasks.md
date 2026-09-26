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
- [ ] Tested against a key set served by a local `node:http` server: first use fetches; a cached `kid` resolves with the server stopped (AC P1.8); an unknown `kid` with the server stopped → `IdentityProviderUnavailableError` (AC P1.7); an unknown `kid` with the server up and still missing → `JWKSNoMatchingKey`; a rotated key is picked up after one refetch
- [ ] Two concurrent misses cause exactly one fetch
- [ ] A hanging server exceeds the timeout → `IdentityProviderUnavailableError`
- [ ] Quick gate passes; at least 7 new tests

**Tests**: unit
**Gate**: quick

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
- [ ] Real signed tokens: valid → `{ sub }` and nothing else; expired, wrong `iss`, wrong `aud`, tampered payload, `alg` other than RS256, no `sub`, non-string `sub` → each rejected with the class the guard maps to 401
- [ ] Quick gate passes; at least 8 new tests

**Tests**: unit
**Gate**: quick

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
- [ ] e2e through `AppModule` with a local key-set server: no header, `Basic` scheme, expired, tampered, wrong `iss`, wrong `aud`, no `sub` → 401 and the in-memory Catalog client records zero calls
- [ ] `/health` answers without a token
- [ ] A composition e2e: `AppModule` refuses to boot when each OIDC variable is missing, and the guard is the registered `APP_GUARD`
- [ ] Existing e2e suites send a valid token and still pass (tests updated to authenticate; no assertion weakened)
- [ ] Build gate passes

**Tests**: e2e
**Gate**: build

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
- [ ] HTTP adapter tests (local server): success, 404 → `undefined`, 500, network failure, malformed body → `CatalogUnavailableError`; the owner is URL-encoded in the path
- [ ] In-memory adapter: two owners never see each other's items
- [ ] Quick gate passes; at least 8 new tests

**Tests**: unit
**Gate**: quick

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
- [ ] Given an item carrying every forbidden field (`sourceStorageKey`, `zipStorageKey`, `failureCode`, `attemptId`, `ownerUserId`, an unknown future field), none survives
- [ ] `failureReason` present for `FAILED`, absent for every other status even when the input carries one
- [ ] Quick gate passes; at least 4 new tests

**Tests**: unit
**Gate**: quick

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
- [ ] e2e: as `alice` with `ownerUserId: "bob"` in the body → 201 and the Catalog client receives `alice`'s `sub`; without the field → 201
- [ ] The response has no `sourceStorageKey`; `sourceStorageKey` still required (400 when missing)
- [ ] Catalog unavailable → 502 (existing behaviour kept)
- [ ] Full gate passes

**Tests**: e2e
**Gate**: full

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
- [ ] e2e: `alice`'s and `bob`'s lists disjoint; defaults applied; `{ items, page, pageSize, total }`; page beyond the end → `items: []` with the true `total`; a user with none → `total: 0`
- [ ] `page=0`, `page=abc`, `pageSize=0`, `pageSize=101` → 400 naming the parameter and range, Catalog not called
- [ ] No forbidden field in any item; Catalog failure → 502
- [ ] Full gate passes

**Tests**: e2e
**Gate**: full

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
- [ ] e2e: the owner gets 200 with the projected item; another user, a random UUID and a malformed id get byte-identical 404 bodies; Catalog failure → 502
- [ ] Build gate passes

**Tests**: e2e
**Gate**: build

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
- [ ] With the server stopped: a token signed by the already-used key → 200 (AC P1.8); a token signed by a new key → 503 `Authentication temporarily unavailable` (AC P1.7), Catalog not called
- [ ] With the server back and serving the new key: that token → 200
- [ ] Verified negatively in a scratch copy: swapping `SigningKeyCache` for `createRemoteJWKSet` makes the 503 assertion fail
- [ ] Build gate passes

**Tests**: e2e
**Gate**: build

---

## Phase Execution Map

```
Phase 1 (T1 T2 T3 T4 T5) then Phase 2 (T6 T7 T8 T9 T10) then Phase 3 (T11)
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

T1 is the only `Tests: none`, on a layer the matrix marks `none`; its correctness is proved by T3's first test importing `jose` under Jest and by the build gate loading the built module.
