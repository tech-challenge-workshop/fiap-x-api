# Auth and Owner Scope Validation — api (Round 2)

**Date**: 2026-09-26
**Spec**: `.specs/features/auth-owner-scope/spec.md` (AUTH-01..AUTH-09)
**Diff range**: `f449e29..636f33a` on `feat/auth-owner-scope`. Round 2 re-verifies fix commit `636f33a` (T13, test-only). `git diff --stat 684aeae 636f33a` touches only `src/auth/signing-key-cache.spec.ts` (+17), `test/auth.e2e-spec.ts` (+6) and `.specs/*`. No production source changed since round 1.
**Verifier**: independent sub-agent, round 2 (author ≠ verifier; this verifier wrote neither the code nor round 1)
**Environment**: Node 22.22.3 on the host. The gates and the sensor ran on a fresh `git archive 636f33a` copy under the scratchpad (`s5api/base2`), with the repo's `node_modules` symlinked. `diff -rq` against the real tree (excluding `.git`, `node_modules`, `dist`) showed no differences. Round 1's `base/` copy was not reused; it differed from HEAD in exactly the two T13 test files. Docker and `fiap-x-platform` were not touched.

**Result**: FAIL. Both round-1 survivors are now killed, each by its new T13 test, and no round-1 kill regressed. The gate is green with 0 skipped. However, 5 of the 9 new round-2 mutants are real survivors:

- The main one is G3 (Major): T13's "never expire" test only fakes `Date.now`, and only after the first fetch. An expiry measured with `performance.now()` or evicted by a timer survives, and so does a 48 h `Date.now` expiry.
- G4 and G5 (Minor) are one-representative gaps in the non-Bearer and no-`exp` edge cases.

A probe proves each real survivor changes observable behaviour that the spec pins, and shows HEAD behaves correctly. All gaps are in the tests; the code is correct.

---

## Task Completion

| Task | Status | Notes |
| --- | --- | --- |
| T1–T12 | ✅ Done | Carried from round 1 (`validation.md` round 1, Task Completion). Production code is byte-identical to round 1's `684aeae`. |
| T13 close the two round-1 test gaps | ✅ Done | `636f33a`. It adds `src/auth/signing-key-cache.spec.ts:56-71` (spies `Date.now` +24 h after an outage, asserts the key still resolves with `requestCount` 1) and `test/auth.e2e-spec.ts:98-103` (`Basic <valid token>` → 401, 0 Catalog calls). Its Done-when claims hold: M11b and M22 are now killed by exactly these tests (see Sensor). |

The diff contains no `SPEC_DEVIATION` markers. T13 changed no production code, as `tasks.md` states.

---

## Source checks (read directly at HEAD)

`src/` is unchanged since round 1, so round 1's source checks carry over. Each cited line was re-read at `636f33a` and still holds:

- The guard is the global `APP_GUARD` (`src/auth/auth.module.ts:31`). The composition assertion `expect(globalGuards).toEqual([JwtAuthGuard])` is at `test/auth-composition.e2e-spec.ts:43`.
- `@Public()` is read from both the handler and the class (`src/auth/jwt-auth.guard.ts:37-40`). The scheme regex `BEARER = /^Bearer ([^\s]+)$/i` is at `jwt-auth.guard.ts:20` and is applied at `:46`.
- The verifier passes `issuer`, `audience`, `algorithms: ['RS256']` and `requiredClaims: ['exp', 'sub']` (`src/auth/token-verifier.ts:21-27`) and returns only `{ sub }` (`:36`).
- The key cache has no expiry: `if (this.keySet)` at `src/auth/signing-key-cache.ts:29`. It refetches only on `JWKSNoMatchingKey` (`:33`), shares the refetch (`:43`), and has a fetch timeout (`:52-54`).
- The projection is an allow-list (`src/processing-requests/projection.ts:24-33`). The configuration fails closed (`src/auth/oidc.config.ts:11-21`).

---

## Spec-Anchored Acceptance Criteria

Only AC P1.8 and the non-Bearer edge case changed with T13; they were re-derived from scratch. For every other row, the round-1 evidence was carried over and its `file:line`s were re-confirmed at HEAD. Line numbers in `test/auth.e2e-spec.ts` after line 97 shifted by +6 because of the new row, and numbers in `src/auth/signing-key-cache.spec.ts` after line 55 shifted by +17. They are updated below.

### P1: Only authenticated calls reach the system (AUTH-01..03)

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| AC1 no Bearer token | 401, Catalog not called | `test/auth.e2e-spec.ts:93` (no header) and `:104` (`Bearer ` with no token), both through `:137` `expect(res.status).toBe(401)`, `:138` `toEqual({ statusCode: 401, message: 'Unauthorized' })` and `:139` `expect(catalogCalls()).toBe(0)`. GET list: `test/list-processing-requests.e2e-spec.ts:216-219`. GET by id: `test/get-processing-request.e2e-spec.ts:124-127`. | ✅ PASS |
| AC2 bad signature | 401, no Catalog | `test/auth.e2e-spec.ts:106-107` (tampered) and `:110-111` (unpublished key), through `:137-139`. Unit: `src/auth/token-verifier.spec.ts:95-97` `toBeInstanceOf(errors.JWSSignatureVerificationFailed)`. | ✅ PASS |
| AC3 expired | 401, no Catalog | `test/auth.e2e-spec.ts:114-115`, through `:137-139`. Unit: `src/auth/token-verifier.spec.ts:75-77` `toBeInstanceOf(errors.JWTExpired)`. | ✅ PASS |
| AC4 wrong `iss` | 401, no Catalog | `test/auth.e2e-spec.ts:118-120`, through `:137-139`. Unit: `src/auth/token-verifier.spec.ts:83` `.toBe('iss')`. | ✅ PASS |
| AC5 `aud` lacks audience | 401, no Catalog | `test/auth.e2e-spec.ts:123-124`, through `:137-139`. Unit: `src/auth/token-verifier.spec.ts:89` `.toBe('aud')`. The array case is at `:65-67`. | ✅ PASS |
| AC6 no `sub` | 401, no Catalog | `test/auth.e2e-spec.ts:127-128`, through `:137-139`. Unit: `src/auth/token-verifier.spec.ts:132` and `:142-148`. | ✅ PASS |
| AC7 keys unfetchable, no cached match | 503, no Catalog | `test/auth.e2e-spec.ts:148` `toBe(503)`, `:149-152` exact body, `:153` 0 calls. `test/auth-outage.e2e-spec.ts:83` `.expect(503)`, `:85-88` body, `:89` 0 calls. Unit: `src/auth/signing-key-cache.spec.ts:78-80` and `:87-89` `toBeInstanceOf(IdentityProviderUnavailableError)`. | ✅ PASS |
| **AC8 cached key keeps working while the provider is unreachable (re-derived)** | Accepted for as long as the outage lasts. The spec is unbounded ("WHILE ... SHALL keep accepting"), and `design.md` makes "no time-based expiry" the mechanism. | Immediate: `test/auth-outage.e2e-spec.ts:73` `.expect(200)`, `:75-76`, and `src/auth/signing-key-cache.spec.ts:52-53`. **Over time (T13):** `src/auth/signing-key-cache.spec.ts:61` `jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 24h)`, `:66` `expect(await modulusOf(key)).toBe(keyA.publicJwk.n)`, `:67` `expect(server.requestCount).toBe(1)`. This kills M11b. However, the time travel covers only `Date.now`, is installed after the first fetch, and spans 24 h, so M31, M32 and M33 survive (**G3**). | ⚠️ Evidence present, sensor gap G3 |
| AC9 no claim beyond `sub`/`iss`/`aud`/`exp` | only `sub` leaves the verifier | `src/auth/token-verifier.spec.ts:57-59` `resolves.toStrictEqual({ sub: 'alice' })`. The structural check is at `token-verifier.ts:36`. | ✅ PASS (SP1, carried) |
| AC10 `/health` without a token | 200 | `test/auth.e2e-spec.ts:160-163` `.expect(200).expect({ status: 'ok' })`. The non-public `/` route gets 401 at `:166-167`. | ✅ PASS |

### P2–P4 (AUTH-04..09)

These are carried unchanged from round 1. The test files involved were not modified by T13. Each cited line was re-read at HEAD and still holds, for example:

- `test/processing-requests.e2e-spec.ts:79-92`: body `ownerUserId: 'bob'` → `toHaveBeenCalledWith('alice', ...)`, an exact `{processingRequestId, status}` body, and `bob`'s `total` 0.
- `test/list-processing-requests.e2e-spec.ts:92-94,102-103,128,136,188-189,203-208`.
- `test/get-processing-request.e2e-spec.ts:66,88-104,111-116`.
- `src/processing-requests/projection.spec.ts:26-30,38`.

| Story | ACs | Result |
| --- | --- | --- |
| P2 owner from token | AC1–AC3 | ✅ PASS (evidence as in round 1) |
| P3 list | AC1–AC10 | ✅ PASS (SP2, carried) |
| P4 read one | AC1–AC4 | ✅ PASS |

**Status**: 15/15 ACs have `file:line` evidence whose asserted values match the spec outcome. AC P1.8's evidence is not yet discriminating over time (G3).

---

## Edge Cases

- [x] **No requests** → `items: []`, `total: 0` and 200: `test/list-processing-requests.e2e-spec.ts:134,136`. Carried.
- [x] **Non-Bearer scheme → 401 (re-derived).**
  - `test/auth.e2e-spec.ts:95-96` sends `Basic YWxpY2U6c2VjcmV0`, which is not discriminating.
  - **New in T13:** `:98-103` sends `` `Basic ${await idp.token()}` `` (a valid token), through `:137` 401, `:138` the exact body and `:139` 0 Catalog calls.
  - This kills M22.
  - Only one scheme (`Basic`) carries a valid token, so a deny-list that refuses `Basic` and accepts anything else (M38) survives (**G4**). Probe: `Token <valid JWT>` gets 401 at HEAD and 200 under M38.
- [x] **Token without `exp` → 401.**
  - e2e: `test/auth.e2e-spec.ts:131-132`, through `:137-139`.
  - Unit: `src/auth/token-verifier.spec.ts:137-139`.
  - Both tokens still carry `iat` (the `test/support/tokens.ts:20` default), so "`exp` required only when `iat` is present" (M36) survives (**G5**). Probe: a token with neither `exp` nor `iat` gets 401 at HEAD and 200 under M36.
- [x] **Rotated-out key** → one refetch, then 401: `src/auth/signing-key-cache.spec.ts:111-114` (`JWKSNoMatchingKey`, `requestCount` 2) and `:122-129`. e2e: `test/auth.e2e-spec.ts:110-111`.
- [x] **Token never logged**: `test/auth.e2e-spec.ts:170-185`.

---

## Discrimination Sensor

**Method**
- Each mutant ran in a fresh `rsync` copy of `base2` (the HEAD archive), without `dist`, with `node_modules` symlinked. The mutants ran three at a time, and each copy was deleted afterwards.
- The Python applier (`apply2.py` over `mutants_r2.py`, which imports round 1's `mutants.py` unchanged) exits non-zero unless every anchor matches exactly once, so no mutant ran unapplied.
- Every mutant passed `tsc --noEmit` (exit 0), so every kill is behavioural.
- For each mutant, the full unit suite (82) and the full e2e suite (52) both ran.
- Failing test names were extracted from the Jest JSON reports.

### Round-1 set re-run at HEAD (31 mutants)

| # | Mutation | Unit failed | E2E failed | Killed? |
| --- | --- | --- | --- | --- |
| M01 | global `APP_GUARD` removed | 0 | 25 | ✅ |
| M02 | controller `@Public()` | 0 | 23 | ✅ |
| M03 | `issuer` dropped | 1 | 1 | ✅ |
| M04 | `audience` dropped | 1 | 1 | ✅ |
| M05 | `algorithms` removed | 2 | 0 | ✅ |
| M06 | `HS256` allowed | 1 | 0 | ✅ |
| M07 | `exp` not required | 1 | 1 | ✅ |
| M08 | missing / non-string `sub` accepted | 3 | 1 | ✅ |
| M09 | IdP unavailable → 401 | 0 | 3 | ✅ |
| M10 | every error → 503 | 0 | 8 | ✅ |
| M11 | 1 ms cache expiry | 1 | 1 | ✅ (the unit kill is new, from T13) |
| **M11b** | **10 min `Date.now` cache expiry** | **1** | 0 | ✅ **Killed** by `src/auth/signing-key-cache.spec.ts:56` "keeps resolving a cached kid a day later while the provider is down, because cached keys never expire (AC P1.8)". This is the only failing test. |
| M12 | no refetch on an unknown `kid` | 5 | 2 | ✅ |
| M13 | refetch not shared | 1 | 0 | ✅ |
| M14 | owner from the body | 0 | 2 | ✅ |
| M15 | projection as a delete-list | 5 | 0 | ✅ |
| M16 | `failureReason` on non-FAILED | 4 | 0 | ✅ |
| M17 | 404 names the id | 0 | 1 | ✅ |
| M18 | `pageSize` clamped | 0 | 4 | ✅ |
| M19 | Catalog called before validation | 0 | 11 | ✅ |
| M20 | token logged | 0 | 1 | ✅ |
| M21 | issuer defaulted | 2 | 1 | ✅ |
| **M22** | **any `Authorization` scheme** | 0 | **1** | ✅ **Killed** by `test/auth.e2e-spec.ts:101` "responds 401 without calling the Catalog for a valid token under a scheme other than Bearer (edge case)". This is the only failing test. |
| M23 | `total` = page length | 0 | 2 | ✅ |
| M24 | Catalog 404 → 502 | 1 | 0 | ✅ |
| M25 | owner not URL-encoded | 2 | 0 | ✅ |
| M26 | no fetch timeout | 1 | 0 | ✅ |
| M27 | `@Public` read from the handler only | 0 | 1 | ✅ |
| M28 | 1 h clock tolerance | 1 | 1 | ✅ |
| M29 | get returns the raw item | 0 | 1 | ✅ |
| M30 | default `pageSize` 10 | 0 | 4 | ✅ |

All 31 are killed. No round-1 kill became a survivor, and every mutant's fail count is equal to or higher than in round 1.

### New in round 2 (9 mutants)

| # | File | Mutation | Unit | E2E | Killed? |
| --- | --- | --- | --- | --- | --- |
| M31 | `src/auth/signing-key-cache.ts:29` | 48 h `Date.now` expiry (beyond T13's 24 h) | 0 | 0 | ❌ Survived: **real (G3)** |
| M32 | `src/auth/signing-key-cache.ts:29` | 10 min expiry measured with `performance.now()` | 0 | 0 | ❌ Survived: **real (G3)** |
| M33 | `src/auth/signing-key-cache.ts:62` | cached set evicted by a 10 min `setTimeout(...).unref()` | 0 | 0 | ❌ Survived: **real (G3)** |
| M34 | `src/auth/jwt-auth.guard.ts:20` | scheme matched case-sensitively (the `i` flag dropped, so `bearer` and `BEARER` are refused) | 0 | 0 | ❌ Survived: equivalent w.r.t. spec (SP3) |
| M35 | `src/auth/jwt-auth.guard.ts:46` | exactly lowercase `bearer ` refused | 0 | 0 | ❌ Survived: equivalent w.r.t. spec (SP3) |
| M36 | `src/auth/token-verifier.ts:26,36` | `exp` required only when `iat` is present | 0 | 0 | ❌ Survived: **real (G5)** |
| M37 | `src/auth/signing-key-cache.ts:29` | 10 min expiry with a stale-if-error fallback (refetch; keep the old set on failure) | 0 | 0 | ❌ Survived: equivalent |
| M38 | `src/auth/jwt-auth.guard.ts:20` | scheme deny-list `/^(?!Basic )\S+ (\S+)$/i` (anything but `Basic` accepted) | 0 | 0 | ❌ Survived: **real (G4)** |
| M39 | `src/auth/oidc.config.ts:27` | `OIDC_JWKS_TIMEOUT_MS=0` accepted | 1 | 0 | ✅ |

**Harness note**: the first M35 was written as `/^(?!bearer )Bearer .../i`. Because of the `i` flag, the lookahead also refused `Bearer`, and 33 e2e tests failed. That was a broken mutant, not a kill. It was replaced by the check at `:46` shown above (`raw.startsWith('bearer ')`), and only the replacement is counted.

### Survivor classification (each confirmed by a probe in scratch, HEAD vs mutant)

The probes live in `s5api/probe-r2.spec.ts` and `s5api/probe-r2.e2e-spec.ts`, and they were run against HEAD and each survivor. HEAD passed every probe.

| Probe | HEAD | Distinguishes |
| --- | --- | --- |
| `Date.now` spied +49 h after an outage, cached `kid` | resolves, 1 fetch | M31 (and M11b) fail; M32, M33 and M37 pass |
| fake timers installed **after** the first fetch, +400 days | resolves | M31 and M32 fail; M33 passes, because its real timer was scheduled before the fakes were installed |
| fake timers (`jest.useFakeTimers({ doNotFake: ['nextTick','setImmediate','queueMicrotask'] })`) installed **before** the first fetch, +400 days | resolves, 1 fetch | M11b, M31, M32 and M33 all fail (`IdentityProviderUnavailableError`); M37 passes |
| `Authorization: bearer <valid>` | 200 | M34 and M35 → 401 |
| `Authorization: BEARER <valid>` | 200 | M34 → 401 |
| `Authorization: Token <valid>` | 401 | M38 → 200 |
| token with neither `exp` nor `iat` | 401 | M36 → 200 |

- **M31, M32, M33 are real (G3).** AC P1.8 has no time bound, and HEAD resolves the key after 400 days. Each mutant stops accepting a cached-key token once its expiry passes during an outage.
  - T13's test at `src/auth/signing-key-cache.spec.ts:61` spies only `Date.now`, installs the spy after the first fetch, and advances 24 h. That kills a `Date.now` expiry under 24 h, but nothing measured with another clock or a timer.
  - A timer-based eviction (M33) is a common way to write a TTL cache.
  - On the question put to this round: M31 on its own (48 h) is a real gap against AC P1.8's unbounded wording, but a minor one. A 24 h horizon is already past typical key-set TTLs, and no finite horizon kills every finite TTL.
  - Rolled together, the fix is cheap, and it kills M31, M32, M33 and M11b at once (see Fix 3).
- **M36 is real (G5).** The spec edge case says "IF the token has no `exp` claim THEN 401", without condition. Both no-`exp` tests keep the default `iat` (`test/support/tokens.ts:20`). The mutant is not a very plausible bug, but the fix is one row.
- **M38 is real (G4).** The spec says "a scheme other than `Bearer` → 401". T13 exercises only `Basic` with a valid token, so a deny-list implementation passes.
- **M34 and M35 are equivalent w.r.t. the spec (SP3).** Both change observable behaviour (`bearer`/`BEARER` get 401), but the spec never says whether scheme matching is case-sensitive.
  - RFC 7235 §2.1 / RFC 6750 treat the scheme as case-insensitive, so HEAD's `/i` is the RFC-correct choice.
  - The spec's "a scheme other than `Bearer`" does not decide whether `bearer` is "other". Pin it in the spec (Fix 5), not as a blocking test gap.
- **M37 is equivalent.** Stale-if-error keeps accepting cached keys while the provider is down, so AC P1.8 holds. A periodic refetch while the provider is up is not forbidden by any AC.

**Sensor depth**: P0 (authentication and authorization). There were 40 behaviour-level mutants: the 31 from round 1 and 9 new ones, aimed at T13's two tests (clock source, horizon, scheme set, scheme case), the `exp` rule's conditionality, and the timeout configuration.

**Isolation**: `git status --porcelain` on the real tree was empty before the run (recorded to `scratchpad/porcelain-before-r2.txt`) and empty after. No `git stash` was used, the real tree was never edited, and the gates and `build` ran only in the scratch copy.

**Sensor outcome**: 32/40 killed. Of the 8 survivors, 5 are real (M31, M32, M33, M36, M38), 3 are equivalent (M34, M35, M37), and 0 are harness-only.

---

## Code Quality

| Principle | Status |
| --- | --- |
| Minimum code / surgical / no scope creep | ✅ T13 is test-only: +17 lines in one unit spec and +6 in one e2e spec. It changes no production code. |
| Matches patterns | ✅ It reuses the `newCache`, `header`, `modulusOf` and `it.each` row patterns. The `Date.now` spy is restored in `finally`. |
| Spec-anchored outcome check | ✅ The new assertions are exact: the key modulus, `requestCount` 1, 401, the exact body, and 0 Catalog calls. |
| Per-layer coverage expectation | ⚠️ Met, but AC P1.8's over-time evidence depends on one clock source (G3). |
| Every test maps to a requirement | ✅ Both new tests name their AC or edge case in the title. |
| Documented guidelines followed | none found; strong defaults applied (carried) |

---

## Gate Check

- **Gate command**: `npm run lint && npm run typecheck && npm test -- --json --outputFile=<scratch>/r2-unit.json && npm run test:e2e -- --json --outputFile=<scratch>/r2-e2e.json && npm run build`, run in the HEAD archive copy.
- **Outcome**: exit 0.
  - Lint (`--max-warnings 0`) and typecheck: clean.
  - Unit: 82 of 82 passed, in 10 suites, with 0 pending, 0 todo and 0 runtime-error suites.
  - e2e: 52 of 52 passed, in 7 suites, with 0 pending, 0 todo and 0 runtime-error suites.
  - Build: exit 0.
- **Skipped**: none. `grep` for `.skip`, `xit(`, `xdescribe`, `.todo` and `.only` in `src` and `test` finds nothing.
- **Test count**: 18 + 6 = 24 before the feature (`f449e29`, from round 1). Round 1 had 81 + 51 = 132. Round 2 has 82 + 52 = **134** (+2, the two T13 tests). No test was removed or weakened.
- **Boot without OIDC**: carried from round 1. `src/` is byte-identical since `684aeae`, so `dist/main` behaviour is unchanged.

---

## Spec-precision gaps

1. **SP1** (AC P1.9: the standard claims `jose` validates) is carried, and non-blocking.
2. **SP2** (AC P3.5: a FAILED item without a reason) is carried, and non-blocking.
3. **SP3 (new): auth-scheme case.**
   - The edge case "a scheme other than `Bearer` → 401" does not say whether `bearer` or `BEARER` counts as "other".
   - HEAD accepts them (`jwt-auth.guard.ts:20` `/i`), which is RFC 7235-conformant. No test pins either behaviour, which is why M34 and M35 survive.
   - Non-blocking. Pin it in `spec.md` (Fix 5).

---

## Fix Plans

### Fix 3 (G3): prove "cached keys never expire" with all clocks faked from the start. Priority: Major (a P0 availability AC; the T13 test covers only `Date.now`-based expiry).

- **Root cause**:
  - `src/auth/signing-key-cache.spec.ts:60-61` spies only `Date.now`.
  - It installs the spy after the first `keyFor`, so any timer scheduled at fetch time runs on the real clock.
  - It advances only 24 h.
- **Fix task**: add (or convert the T13 test to) this form:
  1. `jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] })` **before** `newCache()` and the first `keyFor`.
  2. Stop the server.
  3. `jest.advanceTimersByTime(400 * 24 * 60 * 60 * 1000)`.
  4. Assert that `keyFor(header('key-a'))` resolves to key A and `requestCount` is still 1.
  5. Call `jest.useRealTimers()` in `finally` or `afterEach`.
- **Verify**:
  - The verifier's probe `PROBE-faketimers-early-400d` is exactly this test. It passes on HEAD and fails on M11b, M31, M32 and M33.
  - The real HTTP key-set server and `AbortSignal.timeout` still work under these fake timers, since the probe's first fetch succeeded.

### Fix 4 (G4): the non-Bearer edge with more than one scheme. Priority: Minor.

- **Root cause**: `test/auth.e2e-spec.ts:98-103` uses only `Basic <valid>`.
- **Fix task**: add one row, `` `Token ${await idp.token()}` `` (or any scheme other than `Basic`), through the same 401, exact-body and 0-Catalog-call assertions.
- **Verify**: M38 fails it, and HEAD passes (probe `PROBE-token-scheme`).

### Fix 5 (G5): the no-`exp` edge without `iat`. Priority: Minor.

- **Root cause**: `test/auth.e2e-spec.ts:131-132` and `src/auth/token-verifier.spec.ts:136` sign a token that keeps the default `iat`.
- **Fix task**: add a row, `idp.token({ exp: undefined, iat: undefined })` → 401 (e2e), and/or a unit case with `claimFailure(...)` `toBe('exp')`.
- **Verify**: M36 fails it, and HEAD passes (probe `PROBE-no-exp-no-iat`).

### Fix 6 (SP3, spec wording, non-blocking)

- State in `spec.md` that the scheme is matched case-insensitively, per RFC 7235.
- Optionally add a `bearer <valid>` → 2xx row, which would kill M34 and M35.

---

## Requirement Traceability Update

- **AUTH-01** (the non-Bearer edge) stays at **Implementing** until Fix 4 lands. Its round-1 gap G2 is closed.
- **AUTH-02** (the no-`exp` edge) stays at **Implementing** until Fix 5 lands.
- **AUTH-03** (AC P1.8) stays at **Implementing** until Fix 3 lands. Its round-1 gap G1 is closed only for `Date.now` expiry under 24 h.
- AUTH-04 to AUTH-09 are ready for ✅ Verified.

The Verifier does not edit `spec.md`.

---

## Summary

**Overall**: ❌ Not Ready. The code is correct at HEAD; the tests still miss some faults.

- **Spec-anchored check**: 15/15 ACs and 5/5 edge cases have `file:line` evidence. There are 3 spec-precision notes (SP1 and SP2 carried, SP3 new), none of them blocking.
- **Sensor**: 32/40 killed.
  - M11b and M22 are now killed, by the T13 unit test and e2e row respectively.
  - 0 regressions among the round-1 kills.
  - 5 real survivors: M31, M32 and M33 (G3), M36 (G5) and M38 (G4).
  - 3 equivalent: M34, M35 and M37.
- **Gate**: 134 passed (82 unit + 52 e2e), 0 failed, 0 skipped; lint, typecheck and build are clean.

**What works**: everything round 1 listed, plus these two T13 results:
- A `Date.now` expiry under 24 h is now caught.
- A valid token under `Basic` is now refused, under test.

**Next steps**: route Fix 3 (Major), Fix 4 and Fix 5 (Minor), all test-only, to an implementer, then re-verify. This was fix→re-verify iteration 2 of 3. If the orchestrator declares this the final verifier round, carry G3, G4, G5 and SP3 as open items under "Validar depois".
