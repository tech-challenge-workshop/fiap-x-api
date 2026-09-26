# Auth and Owner Scope Validation — api

**Date**: 2026-09-26
**Spec**: `.specs/features/auth-owner-scope/spec.md` (AUTH-01..AUTH-09)
**Diff range**: `f449e29..684aeae` on `feat/auth-owner-scope`. The implementation is 11 commits from `ca85522` to `684aeae`. `a59a7bb` is a spec-only commit that added T12.
**Verifier**: independent sub-agent (author ≠ verifier)
**Environment**: Node 22.22.3 on the host. The gates ran on a `git archive HEAD` copy under the scratchpad with the repo's `node_modules` symlinked. The real tree was clean at `684aeae`, so the copy matches it byte for byte. Docker was not used.

**Result**: FAIL. All 15 acceptance criteria and all 5 edge cases have `file:line` evidence, and the build gate is green with 0 skipped. However, 2 of 31 behaviour-level mutants survived. A cheap probe proves each survivor changes observable behaviour that the spec pins, so both are real gaps. Both gaps are in the tests; the HEAD code behaves correctly on both probes.

---

## Task Completion

| Task | Status | Notes |
| --- | --- | --- |
| T1 `jose` + Jest transform | ✅ Done | `package.json:30` pins `"jose": "6.2.12"`; `test/jest-e2e.json:14` has the `transformIgnorePatterns` rule. The built `dist/main` loads `jose` at boot (see Gate). |
| T2 OIDC config | ✅ Done | `ca85522` |
| T3 signing-key cache | ✅ Done | `5d8be21` |
| T4 token verifier | ✅ Done | `aab64b6` |
| T5 global guard, `@Public`, `@Owner` | ✅ Done | `04b0f9f` |
| T6 Catalog client reads | ✅ Done | `9183270` |
| T7 projection | ✅ Done | `e79b6bc` |
| T8 create as the token's owner | ✅ Done | `59b6b8c`. The rewritten tests that encoded the old owner-from-body contract were reviewed: `create-processing-request.dto.spec.ts`, `create-processing-request.service.spec.ts` and `test/processing-requests.e2e-spec.ts`. Each rewrite now asserts the new contract at equal or greater strength (for example `:57` `not.toContain('user-123')` was added). The orchestrator accepted these rewrites. |
| T9 list | ✅ Done | `4128d67` |
| T10 read one | ✅ Done | `46ffbc4` |
| T11 outage e2e | ✅ Done | `269559d` |
| T12 reject a token without `exp` | ✅ Done | `684aeae` |

The diff contains no `SPEC_DEVIATION` markers. `tasks.md` records two technical deviations, and both are acceptable:

- T5 added `testPathIgnorePatterns` for `._*` files.
- T9 made `CatalogErrorFilter` pass the exception's message through. As a result, the 400 names the parameter, and a Catalog failure answers `"Catalog unavailable"` on every route.

---

## Source checks (read directly, not inferred from tests)

- **The guard is the global `APP_GUARD`.** `src/auth/auth.module.ts:31` registers `{ provide: APP_GUARD, useClass: JwtAuthGuard }`, and `src/app.module.ts:9` imports `AuthModule`. The composition test at `test/auth-composition.e2e-spec.ts:43` asserts `expect(globalGuards).toEqual([JwtAuthGuard])`.
- **Only `/health` is `@Public()`.** `grep -rn Public src` finds a single use, at `src/health/health.controller.ts:4`, where it is applied at class level. `AppController` (`GET /`) is not public and gets 401 without a token (`test/auth.e2e-spec.ts:160-161`). The guard reads the metadata from both the handler and the class (`src/auth/jwt-auth.guard.ts:37-40`).
- **`TokenVerifier` returns only `sub` (AC P1.9).**
  - `src/auth/token-verifier.ts:36` returns `{ sub: payload.sub }`. The guard stores only that value (`src/auth/jwt-auth.guard.ts:53` `request.owner = (...).sub`).
  - In `src`, no code outside `token-verifier.ts:28,36` reads `payload`. Nothing in `src` calls `decodeJwt` or `decodeProtectedHeader`, and the token header is read only at `jwt-auth.guard.ts:46`.
  - `issuer`, `audience`, `algorithms: ['RS256']` and `requiredClaims: ['exp', 'sub']` are passed to `jwtVerify` at `:21-27`.
- **The projection is an allow-list.** `src/processing-requests/projection.ts:24-33` builds a new object from four named fields and adds `failureReason` only when `status === 'FAILED'`. Nothing is copied or deleted from the input.
  - The list and get services both project: `list-own-processing-requests.service.ts:26` and `get-own-processing-request.service.ts:44`.
  - Create returns only `{ processingRequestId, status }` (`create-processing-request.service.ts:21-26`).
- **Fail-closed configuration.** `src/auth/oidc.config.ts:11-21` throws `"<NAME> is required"` for a missing or blank value. There is no default and no "auth off" path.
- **No token logging.** The guard logs fixed strings plus `error.name` or `error.constructor.name` only (`jwt-auth.guard.ts:48,57,63`).

---

## Spec-Anchored Acceptance Criteria

### P1: Only authenticated calls reach the system (AUTH-01..03)

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| AC1 no Bearer token | 401, Catalog not called | `test/auth.e2e-spec.ts:93,98` (no header; `Bearer ` with no token) → `:131` `expect(res.status).toBe(401)`, `:132` `toEqual({ statusCode: 401, message: 'Unauthorized' })`, `:133` `expect(catalogCalls()).toBe(0)` (POST). GET list `test/list-processing-requests.e2e-spec.ts:216-219`; GET by id `test/get-processing-request.e2e-spec.ts:124-127` | ✅ PASS |
| AC2 bad signature | 401, no Catalog | `test/auth.e2e-spec.ts:100-101` (tampered payload) and `:104-105` (key the provider does not publish), both through `:131-133`. Unit: `src/auth/token-verifier.spec.ts:95-97` `rejects.toBeInstanceOf(errors.JWSSignatureVerificationFailed)` | ✅ PASS |
| AC3 expired | 401, no Catalog | `test/auth.e2e-spec.ts:108-109` (`exp: now-1`) through `:131-133`. Unit: `src/auth/token-verifier.spec.ts:75-77` `toBeInstanceOf(errors.JWTExpired)` | ✅ PASS |
| AC4 wrong `iss` | 401, no Catalog | `test/auth.e2e-spec.ts:112-114` through `:131-133`. Unit: `token-verifier.spec.ts:83` `expect(await claimFailure(token)).toBe('iss')` | ✅ PASS |
| AC5 `aud` lacks audience | 401, no Catalog | `test/auth.e2e-spec.ts:117-118` through `:131-133`. Unit: `token-verifier.spec.ts:89` `.toBe('aud')`. An `aud` array that includes the audience is accepted: `:65-67` | ✅ PASS |
| AC6 no `sub` | 401, no Catalog | `test/auth.e2e-spec.ts:121-122` through `:131-133`. Unit: `token-verifier.spec.ts:132` `.toBe('sub')`; `:142-148` covers a `sub` of `42`, `''` or an object | ✅ PASS |
| AC7 keys unfetchable, no cached match | 503, no Catalog | `test/auth.e2e-spec.ts:142` `toBe(503)`, `:143-146` exact body, `:147` `catalogCalls()` 0 (nothing cached). `test/auth-outage.e2e-spec.ts:83` `.expect(503)`, `:85-88` exact body, `:89` 0 calls (cache holds a different key). Unit: `src/auth/signing-key-cache.spec.ts:61-63,70-72` `toBeInstanceOf(IdentityProviderUnavailableError)` | ✅ PASS |
| AC8 cached key keeps working while provider down | 200 | `test/auth-outage.e2e-spec.ts:73` `.expect(200)`, `:75-76` body and `toHaveBeenCalledWith('bob', 1, 20)`. Unit: `signing-key-cache.spec.ts:52-53` (resolves, `requestCount` 1). **See G1: not pinned over time.** | ✅ PASS (sensor gap G1) |
| AC9 reads no claim other than `sub`/`iss`/`aud`/`exp` | only `sub` leaves the verifier | `src/auth/token-verifier.spec.ts:57-59` `resolves.toStrictEqual({ sub: 'alice' })` for a token carrying `email`, `preferred_username` and `realm_access.roles`. Structural check: `token-verifier.ts:36` | ✅ PASS (spec-precision note SP1) |
| AC10 `/health` without a token | 200 | `test/auth.e2e-spec.ts:155-157` `.expect(200).expect({ status: 'ok' })` | ✅ PASS |

### P2: Requests are owned by the authenticated user (AUTH-04)

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| AC1 owner = token `sub` | Catalog gets `sub` as `ownerUserId` | `test/processing-requests.e2e-spec.ts:82` `expect(createSpy).toHaveBeenCalledWith('alice', 'videos/clip.mp4')`; `:88-91` the request is listed under `alice`. Unit: `create-processing-request.service.spec.ts` asserts `'alice'` reaches the client | ✅ PASS |
| AC2 body `ownerUserId` ignored | `sub` still used; request not rejected | `test/processing-requests.e2e-spec.ts:79` sends `ownerUserId: 'bob'`, `:80` `.expect(201)`, `:82` gets `'alice'`, `:92` `listOwned('bob')` `total` `toBe(0)`. Without the field: `:63-70` → 201 | ✅ PASS |
| AC3 201 with id + status, no `sourceStorageKey` | exact shape | `test/processing-requests.e2e-spec.ts:84-87` `toEqual({ processingRequestId: expect.any(String), status: 'RECEIVED' })`. The in-memory client returns the whole record (`in-memory-catalog-client.adapter.ts:49`), so the API's own projection is what is tested | ✅ PASS |

### P3: A user lists their own requests (AUTH-05..07, AUTH-09)

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| AC1 only the caller's | items ⊆ owner | `test/list-processing-requests.e2e-spec.ts:92` `toEqual([a3, a2, a1])`, `:94` `toEqual([b2, b1])`, `:102-103` `toHaveBeenNthCalledWith(1, 'alice', 1, 20)` / `(2, 'bob', 1, 20)` | ✅ PASS |
| AC2 newest first | `createdAt` desc | `:92` `[a3, a2, a1]`, `:94` `[b2, b1]`. The order comes from the Catalog, which the catalog validation verifies; the API passes it through | ✅ PASS |
| AC3 defaults `page=1`, `pageSize=20` | 1 / 20 | `:93` `toMatchObject({ page: 1, pageSize: 20, total: 3 })`, `:102` Catalog asked with `1, 20` | ✅ PASS |
| AC4 body `{items,page,pageSize,total}` | exact keys, `total` is the caller's count | `:96-101` keys `['items','page','pageSize','total']`, `:93`/`:95` `total` 3 / 2; `:113-118` explicit paging `toEqual({... page: 2, pageSize: 2, total: 3 })` | ✅ PASS |
| AC5 item fields; `failureReason` iff FAILED | exact keys | e2e `:145-150` keys exactly `createdAt, processingRequestId, status, updatedAt` (RECEIVED). Unit `src/processing-requests/projection.spec.ts:26-30` `toStrictEqual({...base, status: 'FAILED', failureReason})`; `:38` `toStrictEqual({ ...base, status })` for RECEIVED/QUEUED/PROCESSING/COMPLETED | ✅ PASS (SP2) |
| AC6 never `sourceStorageKey`/`zipStorageKey`/`failureCode`/`attemptId`/`ownerUserId` | absent in any response | list `test/list-processing-requests.e2e-spec.ts:158-167` `expect(res.text).not.toContain(...)`. By id: `test/get-processing-request.e2e-spec.ts:69-74` exact keys, `:81` no storage-key value. Create: `test/processing-requests.e2e-spec.ts:84-87`. Unit: `projection.spec.ts:26,38-44` with every forbidden field plus `someFutureField` in the input | ✅ PASS |
| AC7 bad `page` → 400 naming it, no Catalog | 400 + `page` message | `test/list-processing-requests.e2e-spec.ts:171-176` (`0`, `-1`, `abc`, `1.5`, empty, repeated) → `:188` `toEqual({ statusCode: 400, message: ['page must be an integer greater than or equal to 1'] })`, `:189` `catalogCalls()` 0 | ✅ PASS |
| AC8 bad `pageSize` → 400 naming it, no Catalog | 400 + `pageSize` message | `:177-180` (`0`, `101`, `abc`, and both at once) → `:188-189`; bounds 1 and 100 accepted at `:194-197` | ✅ PASS |
| AC9 beyond last page | `items: []`, true total | `:128` `toEqual({ items: [], page: 5, pageSize: 1, total: 2 })` | ✅ PASS |
| AC10 Catalog failure → 502 | 502 | `:203` `.expect(502)`, `:205-208` `{ statusCode: 502, message: 'Catalog unavailable' }`. Adapter: `src/processing-requests/adapters/http-catalog-client.adapter.spec.ts:164-176` (500, 404, non-JSON, wrong shape) → `CatalogUnavailableError` | ✅ PASS |

### P4: A user reads one of their requests (AUTH-08, AUTH-09)

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| AC1 owner → 200 with the P3 AC5 shape | 200, exact item | `test/get-processing-request.e2e-spec.ts:66` `.expect(200)`, `:69-74` exact keys, `:75` id, `:76` `RECEIVED` | ✅ PASS |
| AC2 another user → same 404 as missing | byte-identical 404 | `:88` `.expect(404)`, `:95-98` `toEqual({ statusCode: 404, message: 'Processing request not found' })`, `:99` `expect(randomUuid.text).toBe(otherUsers.text)`, `:101-103` same content type; `:104` the Catalog is asked under `'bob'` | ✅ PASS |
| AC3 unknown or malformed id → 404 | 404 | `:89-93` random UUID and `not-a-uuid` → 404, `:99-100` same text. In the real Catalog a non-UUID id is a 404 (`processing-catalog/src/interface/owned-processing-requests.controller.ts:66-67`), which `HttpCatalogClient` maps to `undefined` (`http-catalog-client.adapter.ts:65-67`) | ✅ PASS |
| AC4 Catalog failure → 502 | 502 | `:111` `.expect(502)`, `:113-116` exact body | ✅ PASS |

**Status**: ✅ All 15 ACs have evidence, and every asserted value matches the spec outcome. There are 2 spec-precision notes, neither blocking.

---

## Edge Cases

- [x] **A user with no requests** gets `items: []`, `total: 0` and 200: `test/list-processing-requests.e2e-spec.ts:134` `.expect(200)`, `:136` `toEqual({ items: [], page: 1, pageSize: 20, total: 0 })`.
- [x] **A non-Bearer scheme** gets 401: `test/auth.e2e-spec.ts:95-96` (`Basic YWxpY2U6c2VjcmV0`) through `:131-133`. **This is weak (G2):** the credential is not a JWT, so it gets 401 whatever the scheme. A mutant accepting any scheme survives.
- [x] **A token without `exp`** gets 401: `test/auth.e2e-spec.ts:125-126` through `:131-133`. Unit: `src/auth/token-verifier.spec.ts:137` `expect(decodeJwt(token)).not.toHaveProperty('exp')`, `:139` `.toBe('exp')`.
- [x] **A rotated-out key** triggers one refetch, then 401 if the key is still absent.
  - Unit: `src/auth/signing-key-cache.spec.ts:94-97` `toBeInstanceOf(errors.JWKSNoMatchingKey)` with `requestCount` `toBe(2)`; `:105-112` a rotated key is picked up and the rotated-out one is refused.
  - e2e: `test/auth.e2e-spec.ts:104-105` gives 401 for an unpublished key.
- [x] **The token is never logged**: `test/auth.e2e-spec.ts:171-179` checks that `logs` does not contain the signature, payload or header of two rejected tokens, and that it does contain the error class.

HEAD was also probed with 12 malformed tokens, none of them a test in the suite: `...`, 2 segments, 4 segments, a non-JSON header, no `alg`, no `kid`, a non-JSON payload, an array payload, HS256 or ES256 with the RSA `kid`, a numeric `kid`, and an unknown `crit`. All 12 got 401; none got a 500.

---

## Discrimination Sensor

**Method**
- Each mutant ran in a fresh `rsync` copy of the HEAD archive under the scratchpad, without `dist`, with `node_modules` symlinked.
- The Python applier exits non-zero unless every anchor matches exactly once, so no mutant ran unapplied.
- Every mutant passed `tsc --noEmit` (exit 0), so every kill comes from behaviour, not from a compile error.
- For each mutant, `jest` (unit) and `jest --config test/jest-e2e.json` both ran in full.

| # | File | Mutation | Unit failed | E2E failed | Killed? |
| --- | --- | --- | --- | --- | --- |
| M01 | `src/auth/auth.module.ts:31` | global `APP_GUARD` registration removed | 0 | 24 | ✅ |
| M02 | `src/processing-requests/controllers/processing-requests.controller.ts:21` | controller marked `@Public()` | 0 | 22 | ✅ |
| M03 | `src/auth/token-verifier.ts:22` | `issuer` option dropped | 1 | 1 | ✅ |
| M04 | `src/auth/token-verifier.ts:23` | `audience` option dropped | 1 | 1 | ✅ |
| M05 | `src/auth/token-verifier.ts:24` | `algorithms` removed | 2 | 0 | ✅ |
| M06 | `src/auth/token-verifier.ts:24` | `HS256` allowed | 1 | 0 | ✅ |
| M07 | `src/auth/token-verifier.ts:26` | `requiredClaims` `exp` dropped | 1 | 1 | ✅ |
| M08 | `src/auth/token-verifier.ts:26,28` | missing / non-string `sub` accepted | 3 | 1 | ✅ |
| M09 | `src/auth/jwt-auth.guard.ts:58` | `IdentityProviderUnavailableError` → 401 | 0 | 3 | ✅ |
| M10 | `src/auth/jwt-auth.guard.ts:56` | every error → 503 | 0 | 8 | ✅ |
| M11 | `src/auth/signing-key-cache.ts:29` | key cache with a 1 ms expiry (refetch; outage → 503) | 0 | 1 | ✅ |
| **M11b** | `src/auth/signing-key-cache.ts:29` | **key cache with a realistic 10 min expiry** | 0 | 0 | ❌ **Survived: real gap G1** |
| M12 | `src/auth/signing-key-cache.ts:33` | no refetch on an unknown `kid` once a set is cached | 5 | 2 | ✅ |
| M13 | `src/auth/signing-key-cache.ts:43` | refetch without sharing the in-flight promise | 1 | 0 | ✅ |
| M14 | `src/processing-requests/controllers/processing-requests.controller.ts:35` | create uses the body's `ownerUserId` | 0 | 2 | ✅ |
| M15 | `src/processing-requests/projection.ts:24` | projection turned into a delete-list | 5 | 0 | ✅ |
| M16 | `src/processing-requests/projection.ts:30` | `failureReason` for non-FAILED items | 4 | 0 | ✅ |
| M17 | `src/processing-requests/services/get-own-processing-request.service.ts:42` | 404 body includes the id (differs per id) | 0 | 1 | ✅ |
| M18 | `src/processing-requests/dtos/list-query.dto.ts:34` | `pageSize` clamped to 1..100 instead of 400 | 0 | 4 | ✅ |
| M19 | `src/processing-requests/controllers/processing-requests.controller.ts:39-43` | Catalog called before the query is validated (validation moved into the handler) | 0 | 11 | ✅ |
| M20 | `src/auth/jwt-auth.guard.ts:63` | token appended to the rejection log | 0 | 1 | ✅ |
| M21 | `src/auth/oidc.config.ts:19` | a missing issuer defaults to `http://localhost:8080/realms/fiapx` | 2 | 1 | ✅ |
| **M22** | `src/auth/jwt-auth.guard.ts:20` | **any `Authorization` scheme accepted (`/^\S+ (\S+)$/`)** | 0 | 0 | ❌ **Survived: real gap G2** |
| M23 | `src/processing-requests/services/list-own-processing-requests.service.ts:29` | `total` = items on the page | 0 | 2 | ✅ |
| M24 | `src/processing-requests/adapters/http-catalog-client.adapter.ts:65` | Catalog 404 on `getOwned` → 502 | 1 | 0 | ✅ |
| M25 | `src/processing-requests/adapters/http-catalog-client.adapter.ts:75` | owner not URL-encoded | 2 | 0 | ✅ |
| M26 | `src/auth/signing-key-cache.ts:52-54` | key-set fetch has no timeout | 1 | 0 | ✅ |
| M27 | `src/auth/jwt-auth.guard.ts:37-40` | `@Public` read from the handler only | 0 | 1 | ✅ |
| M28 | `src/auth/token-verifier.ts:24` | 1 h `clockTolerance` | 1 | 1 | ✅ |
| M29 | `src/processing-requests/services/get-own-processing-request.service.ts:44` | get returns the raw Catalog item | 0 | 1 | ✅ |
| M30 | `src/processing-requests/dtos/list-query.dto.ts:36` | default `pageSize` 10 | 0 | 4 | ✅ |

### Survivor classification

- **M11b is a real gap (G1).** AC P1.8 is unbounded ("WHILE the provider is unreachable ... SHALL keep accepting"). The design makes "no time-based expiry" the mechanism behind it (`design.md` SigningKeyCache notes). Every outage test stops the provider immediately after the first fetch, so any expiry longer than the test's few milliseconds passes.
  - Probe, run in scratch: authenticate once, stop the provider, advance `Date.now` by 11 minutes, send a fresh token signed by the cached key.
  - HEAD returns **200**; M11b returns **503**. A test that controls the clock kills the mutant.
- **M22 is a real gap (G2).** The spec edge case is "a scheme other than Bearer → 401", but the only test sends `Basic YWxpY2U6c2VjcmV0`, which is not a JWT. It would get 401 from the verifier whatever the scheme.
  - Probe, run in scratch: `Authorization: Basic <valid JWT>`.
  - HEAD returns **401**; M22 returns **200**.

Neither survivor is equivalent, and neither depends on the harness: each has an input that tells it apart from HEAD, and HEAD handles that input correctly. The weakness is only in the tests.

**Sensor depth**: P0 (authentication and authorization). 31 behaviour-level mutants covered:
- every `jwtVerify` option;
- the 401/503 mapping;
- the key cache's expiry, refetch, sharing and timeout;
- the guard's registration, `@Public` scope, scheme and logging;
- owner-from-body, the projection, the 404 oracle, pagination validation and ordering against the Catalog call;
- the adapter's 404 and URL encoding;
- configuration defaults.

**Isolation**: the real tree's `git status --porcelain` was empty before and after, and the two are identical. No `git stash` was used, and the real tree was never edited.
**Sensor outcome**: 29/31 killed; 2 survived (real 2, equivalent 0, harness-only 0).

---

## Code Quality

| Principle | Status |
| --- | --- |
| Minimum code / surgical / no scope creep | ✅ New code is confined to `src/auth/*` (7 files) and the processing-requests slice. The old `create-processing-request.controller.ts` was replaced, not duplicated. |
| Matches patterns | ✅ Port/adapter kept, the in-memory double was extended, the error → HTTP mapping is in the same style as creation |
| Spec-anchored outcome check | ✅ Exact status codes, exact 401/503/404/400/502 bodies, exact 400 messages, `toStrictEqual` shapes, and the Catalog call count asserted as 0 |
| Per-layer coverage expectation | ✅ Unit tests for config, key cache (real HTTP key-set server), verifier (real RS256 tokens), adapters and projection. e2e tests through `AppModule` for every route, every 401 cause, 503, outage and composition. |
| Every test maps to a requirement | ✅ Spot-checked all new suites. Extra tests, such as alg `none`, `aud` arrays, bounds and error-status key sets, map to Done-when items in `tasks.md`. |
| Documented guidelines followed | none found; strong defaults applied (as `tasks.md` states) |

---

## Gate Check

- **Gate command**: `npm run lint && npm run typecheck && npm test -- --json --outputFile=<scratch>/unit.json && npm run test:e2e -- --json --outputFile=<scratch>/e2e.json && npm run build`
- **Outcome**: exit 0.
  - Lint and typecheck: 0 errors each.
  - Unit: 81 of 81 passed, in 10 suites, with 0 pending and 0 todo.
  - e2e: 51 of 51 passed, in 7 suites, with 0 pending and 0 todo according to the JSON report.
  - Build: exit 0.
- **Boot without OIDC**: `node dist/main` with `OIDC_ISSUER`, `OIDC_AUDIENCE` and `OIDC_JWKS_URL` unset exits **1** with `Error: OIDC_ISSUER is required`. With only `OIDC_ISSUER` unset it also exits 1 with the same message. With all three set, it logs `Nest application successfully started` and keeps running until the watchdog kills it, so `jose` loads from the built output.
- **Before** (`f449e29`, run in a `git archive` scratch copy): 18 unit + 6 e2e = 24. **After**: 81 + 51 = 132. **Delta**: +108.
  - The T8 rewrites of three pre-existing tests change contract, not strength: `rejects missing ownerUserId` became `accepts a body without ownerUserId`, and the 400 for a missing owner became a 201.
  - Neither suite lost a test.
- **Skipped**: none

---

## Spec-precision gaps

1. **SP1: AC P1.9 "SHALL read no claim other than `sub`, `iss`, `aud`, `exp`".**
   - `jose.jwtVerify` also validates `nbf` and the type of `iat` whenever they are present, and it honours the `crit` and `b64` headers.
   - That goes beyond the literal wording, though only in the restrictive direction. It also matches the AC's stated intent: no proprietary claims (`docs/foudation.md`, AD-005).
   - The spec does not say whether standard registered claims that the library validates count as "read". Non-blocking.
2. **SP2: AC P3.5 "`failureReason` if and only if `status` is `FAILED`".**
   - `projection.ts:30` requires both `status === 'FAILED'` and `failureReason !== undefined`, so a FAILED item without a reason would carry no `failureReason`.
   - The Catalog always sets the reason for FAILED (catalog validation, SP1 there), so this cannot happen today.
   - The spec is silent on this case. Non-blocking.

---

## Fix Plans

### Fix 1 (G1): pin "cached keys never expire" over time. Priority: Major, since it is the test for a P0 availability AC.

- **Root cause**: `src/auth/signing-key-cache.spec.ts:45-54` and `test/auth-outage.e2e-spec.ts:69-77` stop the provider immediately after the first fetch. No test lets time pass during the outage.
- **Fix task**: in `signing-key-cache.spec.ts`:
  1. Resolve `key-a`, then stop the server.
  2. Advance the clock well past any plausible TTL, for example `jest.spyOn(Date, 'now')` or fake timers by 24 h.
  3. Assert `keyFor(header('key-a'))` still resolves to key A, with `requestCount` still 1.
- **Verify**: M11b (`Date.now() - fetchedAt < 600_000` guard in `keyFor`) must fail the new test, and HEAD must pass it. The verifier's probe did exactly this in e2e.

### Fix 2 (G2): make the non-Bearer edge case discriminating. Priority: Minor. HEAD is correct; only the test is weak.

- **Root cause**: `test/auth.e2e-spec.ts:95-96` uses a non-JWT credential, so the verifier rejects it whatever the scheme check does.
- **Fix task**: add a row that sends a **valid** token under another scheme, for example `` `Basic ${await idp.token()}` `` and/or `` `Token ${await idp.token()}` ``. Assert 401, the `Unauthorized` body and 0 Catalog calls.
- **Verify**: M22 (`BEARER = /^\S+ ([^\s]+)$/i`) must fail it, and HEAD must pass it.

### Non-blocking notes

- **Unknown-`kid` refetch has no rate limit.** Every request carrying an unknown `kid` causes one key-set fetch; concurrent requests share one. The design accepts this (`design.md` "refetch only on an unknown kid"), and it is within spec. A caller can use it to generate load on the identity provider. Consider a short negative cache in a later slice.
- **Pin SP1 and SP2 in `spec.md` wording.** Minor.

---

## Requirement Traceability Update

AUTH-01 to AUTH-09 are functionally met at HEAD. The two gaps are in the tests, not the code:

- AUTH-03 (AC P1.8) stays at **Implementing** until Fix 1 lands.
- AUTH-01 (the non-Bearer edge case) stays at **Implementing** until Fix 2 lands.
- The others (AUTH-02, AUTH-04 to AUTH-09) are ready to move to ✅ Verified on the re-verify pass.

The Verifier does not edit `spec.md`.

---

## Summary

**Overall**: ❌ Not Ready. The code is correct and the gaps are in the tests; two small fix tasks are needed.

- **Spec-anchored check**: 15/15 ACs and 5/5 edge cases have evidence; 2 spec-precision notes (non-blocking).
- **Sensor**: 29/31 killed; 2 real-gap survivors (M11b, M22).
- **Gate**: 132 passed (81 unit + 51 e2e), 0 skipped; lint, typecheck and build are clean. The built app refuses to boot without the OIDC variables (exit 1).

**What works**:
- The guard is global and fails closed, and only `/health` is public.
- Every `jwtVerify` option is pinned by a test: `iss`, `aud`, RS256-only, required `exp` and `sub`, and zero clock tolerance.
- The 401/503 split holds through the running app, including a real provider outage.
- The owner always comes from `sub`.
- The projection is an allow-list.
- The 404 is byte-identical for a foreign, unknown or malformed id.
- Pagination errors are exact 400s, with no Catalog call.
- No token material is logged.

**Next steps**: route Fix 1 and Fix 2 to an implementer as test-only changes, then re-verify. This was fix→re-verify iteration 1 of 3.
