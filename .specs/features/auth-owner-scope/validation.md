# Auth and Owner Scope Validation — api (Round 3, final)

**Date**: 2026-09-26
**Spec**: `.specs/features/auth-owner-scope/spec.md` (AUTH-01..AUTH-09), including the new edge-case sentence that the auth scheme is matched case-insensitively (RFC 7235 §2.1).
**Diff range**: `f449e29..4c4edae` on `feat/auth-owner-scope`. Round 3 re-verifies fix commit `4c4edae` (T14, test-only). `git diff 636f33a..4c4edae` touches only `src/auth/signing-key-cache.spec.ts`, `test/auth.e2e-spec.ts`, `spec.md` (one sentence) and `tasks.md`/`validation.md`/lessons. No production source changed since round 1 (`684aeae`).
**Verifier**: independent sub-agent, round 3 (final). This verifier wrote none of the code, none of the tests and neither earlier round.
**Environment**: Node 22.22.3. Gates and sensor ran on a fresh `git archive 4c4edae` copy (`scratchpad/s5api/base3`) with the repo's `node_modules` symlinked. `diff -rq` against the real tree (excluding `.git`, `node_modules`, `dist`, `._*`) showed no differences. Docker and `fiap-x-platform` were not touched.

**Result**: FAIL (final round; the remaining gaps are recorded as open items for "Validar depois", not fixed).

- All five round-2 real survivors (M31, M32, M33, M36, M38) are now killed, each by the T14 test named for it. No earlier kill regressed.
- M34 and M35 (scheme case) were "equivalent" in round 2 only because the spec was silent. The spec now says `bearer` and `BEARER` SHALL be accepted, and no test sends either, so both are now **real** survivors (OI-2).
- Two of the six new mutants survive and are real: the token (or its signature) can be logged on the `503` branch (M42) and on the no-bearer branch (M43). The "never logs the token" edge case is proven only on the JOSE-rejection branch (OI-1).
- The code at HEAD is correct for every one of these: a probe shows HEAD accepts `bearer`/`BEARER` and logs no signature on either branch. All gaps are in the tests.

---

## Task Completion

| Task | Status | Notes |
| --- | --- | --- |
| T1–T12 | ✅ Done | Carried from rounds 1–2. `src/` is byte-identical to `684aeae`. |
| T13 | ✅ Done | Carried from round 2. Its `Date.now` test was rewritten by T14. |
| T14 close the round-2 gaps | ✅ Done, one Done-when only partly effective | `4c4edae`. Adds fake timers before the first fetch plus a 400-day advance (`src/auth/signing-key-cache.spec.ts:56-76`), a `Token <valid>` row (`test/auth.e2e-spec.ts:104-109`) and a no-`exp`/no-`iat` row (`:140-146`), and the spec sentence on case. Its Done-when claims about M31/M32/M33/M36/M38 hold exactly (see Sensor). The spec sentence was added without a test that pins it, so M34/M35 are not killed. |

No `SPEC_DEVIATION` markers in the diff. T14 changed no production code.

---

## Source checks (re-read at HEAD `4c4edae`)

- Global guard: `src/auth/auth.module.ts:31` (`APP_GUARD`), composition assertion `test/auth-composition.e2e-spec.ts:43`.
- `@Public()` from handler and class: `src/auth/jwt-auth.guard.ts:37-40`.
- Scheme regex `BEARER = /^Bearer ([^\s]+)$/i`: `src/auth/jwt-auth.guard.ts:20`, applied at `:46`. The `/i` flag is what the new spec sentence requires.
- Log lines: no-bearer branch `jwt-auth.guard.ts:48` (constant text), 503 branch `:57` (`error.name` only), JOSE branch `:63` (`error.constructor.name` only). No token reaches any log call at HEAD.
- Verifier: `issuer`, `audience`, `algorithms: ['RS256']`, `requiredClaims: ['exp', 'sub']` at `src/auth/token-verifier.ts:21-27`; returns only `{ sub }` at `:36`.
- Key cache without expiry: `src/auth/signing-key-cache.ts:29`; refetch only on `JWKSNoMatchingKey` (`:33`), exactly once per miss (`:38-39`), shared (`:43`), with timeout (`:52-54`).
- Projection allow-list `src/processing-requests/projection.ts:24-33`; create returns only `{ processingRequestId, status }` at `src/processing-requests/services/create-processing-request.service.ts:26`; one 404 for every miss at `src/processing-requests/services/get-own-processing-request.service.ts:42`.

---

## Spec-Anchored Acceptance Criteria

`test/auth.e2e-spec.ts` and `src/auth/signing-key-cache.spec.ts` changed in T14, so their line numbers are updated below. Every other test file is unchanged since round 2, and its citations were re-read at HEAD and still hold.

### P1: Only authenticated calls reach the system (AUTH-01..03)

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| AC1 no Bearer token | 401, Catalog not called | `test/auth.e2e-spec.ts:93` (no header), `:110` (`Bearer `), through `:150` `expect(res.status).toBe(401)`, `:151` `toEqual({ statusCode: 401, message: 'Unauthorized' })`, `:152` `expect(catalogCalls()).toBe(0)`. List: `test/list-processing-requests.e2e-spec.ts:211-219`. Get: `test/get-processing-request.e2e-spec.ts:119-127`. | ✅ PASS |
| AC2 bad signature | 401, no Catalog | `test/auth.e2e-spec.ts:112-113` (tampered), `:116-117` (unpublished key), through `:150-152`. | ✅ PASS |
| AC3 expired | 401, no Catalog | `test/auth.e2e-spec.ts:120-121`, through `:150-152`. | ✅ PASS |
| AC4 wrong `iss` | 401, no Catalog | `test/auth.e2e-spec.ts:124-126`, through `:150-152`. | ✅ PASS |
| AC5 wrong `aud` | 401, no Catalog | `test/auth.e2e-spec.ts:129-130`, through `:150-152`. | ✅ PASS |
| AC6 no `sub` | 401, no Catalog | `test/auth.e2e-spec.ts:133-134`, through `:150-152`. | ✅ PASS |
| AC7 keys unfetchable, no cached match | 503, no Catalog | `test/auth.e2e-spec.ts:161` `toBe(503)`, `:162-165` exact body, `:166` 0 calls. `test/auth-outage.e2e-spec.ts:83-89`. Unit `src/auth/signing-key-cache.spec.ts:78-95`. | ✅ PASS |
| **AC8 cached key keeps working while the provider is unreachable (re-derived)** | Accepted for as long as the outage lasts (unbounded "WHILE"; `design.md`: no time-based expiry). | Immediate: `test/auth-outage.e2e-spec.ts:69-76` (`.expect(200)`, exact page body, `listSpy` called with `'bob'`); `src/auth/signing-key-cache.spec.ts:45-53`. **Over time (T14):** `src/auth/signing-key-cache.spec.ts:60-62` `jest.useFakeTimers({ doNotFake: ['nextTick','setImmediate','queueMicrotask'] })` installed **before** `newCache()` and the first fetch (`:64-65`), `:68` `jest.advanceTimersByTime(400 days)`, `:71` `expect(await modulusOf(key)).toBe(keyA.publicJwk.n)`, `:72` `expect(server.requestCount).toBe(1)`. Kills M11, M11b, M31, M32, M33 and the new hrtime mutant M40. | ✅ PASS |
| AC9 no claim beyond `sub`/`iss`/`aud`/`exp` | only `sub` leaves the verifier | `src/auth/token-verifier.spec.ts:57-59` `resolves.toStrictEqual({ sub: 'alice' })`. | ✅ PASS (SP1 carried) |
| AC10 `/health` without a token | 200 | `test/auth.e2e-spec.ts:172-176` `.expect(200).expect({ status: 'ok' })`; non-public `/` 401 at `:179-180`. | ✅ PASS |

### P2–P4 (AUTH-04..09)

Unchanged test files; citations re-read at HEAD:
- P2: `test/processing-requests.e2e-spec.ts:79-92` (body `ownerUserId: 'bob'`, owner `alice`, exact `{processingRequestId, status}` body). The new M44 (create echoes `sourceStorageKey`) is killed by it.
- P3: `test/list-processing-requests.e2e-spec.ts:92-94,102-103,128,136,188-189,203-208`.
- P4: `test/get-processing-request.e2e-spec.ts:66,84-104,107-116`. The new M45 (malformed id → 400) is killed by `:93` `read(bob, 'not-a-uuid').expect(404)`.
- Projection: `src/processing-requests/projection.spec.ts:26-30,38`.

| Story | ACs | Result |
| --- | --- | --- |
| P2 owner from token | AC1–AC3 | ✅ PASS |
| P3 list | AC1–AC10 | ✅ PASS (SP2 carried) |
| P4 read one | AC1–AC4 | ✅ PASS |

**Status**: 27/27 ACs have `file:line` evidence whose asserted values match the spec outcome, and AC P1.8 is now discriminating over time.

---

## Edge Cases (re-derived where T14 or the spec changed)

- [x] **No requests** → `items: []`, `total: 0`, 200: `test/list-processing-requests.e2e-spec.ts:134,136`.
- [ ] **Non-Bearer scheme → 401, scheme matched case-insensitively (re-derived against the new sentence).**
  - Rejection half: ✅ `test/auth.e2e-spec.ts:95-96` (`Basic` junk), `:101-102` (`Basic <valid>`), `:107-108` (`Token <valid>`, new in T14), through `:150-152`. M22 and M38 are killed.
  - Acceptance half ("`bearer` and `BEARER` are accepted"): ❌ **no evidence**. `grep -rniE bearer src test` finds no test sending a non-`Bearer` spelling; the only positive test is `test/auth.e2e-spec.ts:85-90` with `Bearer`. HEAD does accept both (probe `PROBE-lower`, `PROBE-upper` → 200), but M34 (`/i` dropped) and M35 (lowercase refused) survive the whole suite. **OI-2.**
- [x] **Token without `exp` → 401.** `test/auth.e2e-spec.ts:137-138` (keeps `iat`) and, new in T14, `:143-145` `idp.token({ exp: undefined, iat: undefined })` (the helper deletes `undefined` claims, `test/support/tokens.ts:24-28`), through `:150-152`. Unit `src/auth/token-verifier.spec.ts:135-140`. M36 is killed.
- [x] **Rotated-out key** → one refetch, then 401: `src/auth/signing-key-cache.spec.ts:112-119` (`JWKSNoMatchingKey`, `requestCount` 2) and `:122-134`; e2e `test/auth.e2e-spec.ts:116-117`. The new M41 (refetch twice) is killed by `:119` and `:130`.
- [ ] **The API SHALL NOT log the token or any part of its signature.**
  - ✅ JOSE-rejection branch: `test/auth.e2e-spec.ts:183-198` (tampered and rogue tokens; logs contain the class name and none of header, payload, signature). M20 is killed.
  - ❌ The `503` branch (`jwt-auth.guard.ts:57`) and the no-bearer branch (`:48`) are never exercised with a capturing logger. M42 (token appended to the 503 log) and M43 (raw `Authorization` header in the no-bearer log, which carries the JWT for `Token <jwt>` / `Basic <jwt>`) survive. HEAD logs nothing sensitive on either branch (probes `PROBE-log503`, `PROBE-lognobearer` pass). **OI-1.**

---

## Discrimination Sensor

**Method**
- Each mutant ran in a fresh `rsync` copy of `base3` (the HEAD archive), without `dist`, with `node_modules` symlinked, three at a time; each copy was deleted afterwards (`s5api/run-one3.sh`).
- The applier `apply3.py` over `mutants_r3.py` (which imports `mutants_r2.py` and `mutants.py` unchanged) exits non-zero unless every anchor matches exactly once. All 46 anchors were pre-checked on `base3`; 0 APPLYFAIL.
- Every mutant passed `tsc --noEmit` (exit 0), so every kill is behavioural.
- Full unit (82) and full e2e (54) suites ran for every mutant; failing test names were taken from the Jest JSON reports (`s5api/res3/`, summary in `s5api/sensor-r3.log`).

### Round-1 and round-2 sets re-run at HEAD (40 mutants)

| # | Mutation | Unit | E2E | Killed? |
| --- | --- | --- | --- | --- |
| M01 | global `APP_GUARD` removed | 0 | 27 | ✅ |
| M02 | controller `@Public()` | 0 | 25 | ✅ |
| M03 | `issuer` dropped | 1 | 1 | ✅ |
| M04 | `audience` dropped | 1 | 1 | ✅ |
| M05 | `algorithms` removed | 2 | 0 | ✅ |
| M06 | `HS256` allowed | 1 | 0 | ✅ |
| M07 | `exp` not required | 1 | 2 | ✅ |
| M08 | missing / non-string `sub` accepted | 3 | 1 | ✅ |
| M09 | IdP unavailable → 401 | 0 | 3 | ✅ |
| M10 | every error → 503 | 0 | 9 | ✅ |
| M11 | 1 ms cache expiry | 1 | 3 | ✅ |
| M11b | 10 min `Date.now` expiry | 1 | 0 | ✅ |
| M12 | no refetch on unknown `kid` | 5 | 2 | ✅ |
| M13 | refetch not shared | 1 | 0 | ✅ |
| M14 | owner from body | 0 | 2 | ✅ |
| M15 | projection as delete-list | 5 | 0 | ✅ |
| M16 | `failureReason` on non-FAILED | 4 | 0 | ✅ |
| M17 | 404 names the id | 0 | 1 | ✅ |
| M18 | `pageSize` clamped | 0 | 4 | ✅ |
| M19 | Catalog before validation | 0 | 11 | ✅ |
| M20 | token logged on JOSE rejection | 0 | 1 | ✅ |
| M21 | issuer defaulted | 2 | 1 | ✅ |
| M22 | any scheme accepted | 0 | 2 | ✅ (now also by the T14 `Token` row) |
| M23 | `total` = page length | 0 | 2 | ✅ |
| M24 | Catalog 404 → 502 | 1 | 0 | ✅ |
| M25 | owner not URL-encoded | 2 | 0 | ✅ |
| M26 | no fetch timeout | 1 | 0 | ✅ |
| M27 | `@Public` from handler only | 0 | 1 | ✅ |
| M28 | 1 h clock tolerance | 1 | 1 | ✅ |
| M29 | get returns raw item | 0 | 1 | ✅ |
| M30 | default `pageSize` 10 | 0 | 4 | ✅ |
| **M31** | 48 h `Date.now` expiry | **1** | 0 | ✅ **Killed** by `src/auth/signing-key-cache.spec.ts:56` "keeps resolving a cached kid 400 days later while the provider is down, because cached keys never expire (AC P1.8)" (only failing test) |
| **M32** | 10 min `performance.now()` expiry | **1** | 0 | ✅ **Killed** by the same test, `signing-key-cache.spec.ts:56` (only failing test) |
| **M33** | 10 min `setTimeout(...).unref()` eviction | **1** | 0 | ✅ **Killed** by the same test, `signing-key-cache.spec.ts:56` (only failing test) |
| M34 | scheme case-sensitive (`/i` dropped) | 0 | 0 | ❌ Survived: **real now (OI-2)** |
| M35 | exactly lowercase `bearer ` refused | 0 | 0 | ❌ Survived: **real now (OI-2)** |
| **M36** | `exp` required only when `iat` present | 0 | **1** | ✅ **Killed** by `test/auth.e2e-spec.ts:143` "responds 401 without calling the Catalog for a validly signed token without exp or iat (edge case)" (only failing test) |
| M37 | 10 min expiry with stale-if-error | 0 | 0 | ❌ Survived: equivalent (carried) |
| **M38** | deny-list: anything but `Basic` | 0 | **1** | ✅ **Killed** by `test/auth.e2e-spec.ts:107` "responds 401 without calling the Catalog for a valid token under the Token scheme (edge case)" (only failing test) |
| M39 | `OIDC_JWKS_TIMEOUT_MS=0` accepted | 1 | 0 | ✅ |

All 34 earlier kills still hold; every fail count is equal to or higher than in round 2. No regression.

### New in round 3 (6 mutants)

| # | File | Mutation | Unit | E2E | Killed? |
| --- | --- | --- | --- | --- | --- |
| M40 | `src/auth/signing-key-cache.ts:29,62` | 10 min expiry measured with `process.hrtime.bigint()` (tests T14's "every clock source" claim) | 1 | 0 | ✅ by `signing-key-cache.spec.ts:56` |
| M41 | `src/auth/signing-key-cache.ts:38-39` | unknown `kid` refetched twice (spec: "refetch the key set once") | 2 | 0 | ✅ by `signing-key-cache.spec.ts:112` and `:122` |
| M42 | `src/auth/jwt-auth.guard.ts:57` | token appended to the `503` log line | 0 | 0 | ❌ Survived: **real (OI-1)** |
| M43 | `src/auth/jwt-auth.guard.ts:48` | raw `Authorization` header in the no-bearer log line | 0 | 0 | ❌ Survived: **real (OI-1)** |
| M44 | `src/processing-requests/services/create-processing-request.service.ts:26` | create response echoes `sourceStorageKey` (P2.3 / AUTH-09) | 1 | 1 | ✅ by `create-processing-request.service.spec.ts` and `test/processing-requests.e2e-spec.ts` "creates as the token's sub ... answers only id and status" |
| M45 | `src/processing-requests/controllers/processing-requests.controller.ts:47` | `ParseUUIDPipe` on `:id` (malformed id → 400, P4.3) | 0 | 3 | ✅ by `test/get-processing-request.e2e-spec.ts:84` and two more |

**Candidates considered and deliberately not added (unbounded variants of already-covered rules):**
- a cache TTL longer than the 400-day test horizon: yet another finite expiry horizon; no finite test kills every finite TTL;
- `setInterval` eviction or `new Date()`-based expiry: variants of M33 / M11b, faked by the same fake-timers install;
- `process.uptime()`-based expiry: not faked by Jest's fake timers, so no fake-clock test can kill it; judged an implausible way to write a TTL, and noted here as a known limit of the P1.8 test rather than as a gap;
- mixed-case schemes (`bEaReR`), other deny-list sets (`Basic|Token`), `exp` required unless `nbf`: variants of M34, M38 and M36.

### Survivor classification (probes in scratch, HEAD vs mutant)

Probe file `s5api/probe-r3.e2e-spec.ts`, runner `s5api/run-probe3.sh`:

| Probe | HEAD | M34 | M35 | M42 | M43 |
| --- | --- | --- | --- | --- | --- |
| `PROBE-lower`: `bearer <valid>` → 200 | ok | FAIL | FAIL | ok | ok |
| `PROBE-upper`: `BEARER <valid>` → 200 | ok | FAIL | ok | ok | ok |
| `PROBE-log503`: unknown-key token while provider down → 503, signature absent from logs | ok | ok | ok | FAIL | ok |
| `PROBE-lognobearer`: `Token <valid>` → 401, signature absent from logs | ok | ok | ok | ok | FAIL |

- **M34, M35: real (OI-2, Minor).** The spec now states "`bearer` and `BEARER` are accepted". Each mutant returns 401 for a spelling the spec requires to be accepted. T14 added the sentence as "the existing behaviour" but no test pins it. Impact: interoperability (a client sending `bearer` is locked out); not a security hole.
- **M42, M43: real (OI-1, Major).** The edge case "SHALL NOT log the token or any part of its signature" is unconditional. The only log test (`test/auth.e2e-spec.ts:183-198`) drives the JOSE-rejection branch; the `503` branch and the no-bearer branch are never observed. Either mutant writes a live, valid bearer token into the logs. Impact: credential leakage into log storage — a security property of a P0 feature, though HEAD itself is correct.
- **M37: equivalent** (carried): stale-if-error keeps accepting cached keys during an outage, so AC P1.8 holds; no AC forbids a periodic refetch while the provider is up.

**Sensor depth**: P0 (authentication/authorization). 46 behaviour-level mutants: 31 (round 1) + 9 (round 2) + 6 new.

**Isolation**: `git status --porcelain` on the real tree was empty before (`scratchpad/porcelain-r3-before.txt`) and empty after (`scratchpad/porcelain-r3-after.txt`); `cmp` identical. HEAD stayed `4c4edae`; `git stash list` is empty; the real tree was never edited; gates and build ran only in the scratch copy.

**Sensor outcome**: 41/46 killed. 5 survivors: 4 real (M34, M35, M42, M43), 1 equivalent (M37), 0 harness-only.

---

## Code Quality

| Principle | Status |
| --- | --- |
| Minimum code / surgical / no scope creep | ✅ T14 is test-only (+ one spec sentence). |
| Matches patterns | ✅ Reuses `newCache`/`header`/`modulusOf` and the `it.each` rows; fake timers restored in `finally`. |
| Spec-anchored outcome check | ✅ Exact modulus, `requestCount` 1, 401, exact body, 0 Catalog calls. |
| Per-layer coverage expectation | ⚠️ Guard branches for the 503 and no-bearer paths lack log assertions (OI-1); scheme case acceptance has no route test (OI-2). |
| Every test maps to a requirement | ✅ New tests name their AC or edge case. |
| Documented guidelines followed | none found; strong defaults applied (carried) |

---

## Gate Check

- **Gate command**: `npm run lint && npm run typecheck && npm test -- --ci --json --outputFile=<scratch>/r3-unit.json && npm run test:e2e -- --ci --json --outputFile=<scratch>/r3-e2e.json && npm run build`, in the HEAD archive copy.
- **Outcome**: exit 0. Lint and typecheck clean. Unit 82/82 passed (10 suites, 0 pending, 0 todo, 0 runtime-error suites). e2e 54/54 passed (7 suites, 0 pending, 0 todo, 0 runtime-error suites). Build exit 0.
- **Skipped**: none. `grep` for `.skip`, `xit(`, `xdescribe`, `.todo`, `.only` in `src` and `test` finds nothing.
- **Test count**: 24 before the feature; round 2 had 134; round 3 has 82 + 54 = **136** (+2 e2e rows from T14; the T13 unit test was rewritten in place, not removed). No test removed; no assertion weakened (the rewritten P1.8 test is strictly stronger: all clocks, earlier install, 400 days vs 24 h).

---

## Spec-precision notes

1. **SP1** (AC P1.9) carried, non-blocking.
2. **SP2** (AC P3.5, FAILED item without a reason) carried, non-blocking.
3. **SP3 resolved in the spec** by the RFC 7235 sentence; what remains is a test gap (OI-2), not a precision gap.

---

## Open items (Validar depois) — ranked

The user's standing decision makes this the last verifier round, so these are recorded, not routed as fix tasks now.

### OI-1 (Major): prove "never logs the token" on every guard branch that logs

- **Evidence gap**: `test/auth.e2e-spec.ts:183-198` covers only the JOSE-rejection branch (`src/auth/jwt-auth.guard.ts:63`). The `503` branch (`:57`) and the no-bearer branch (`:48`) are unobserved; M42 and M43 survive.
- **Suggested fix (test-only)**: in the same suite, with the capturing logger, (a) stop the provider and send `Bearer <token signed by an unpublished key>` → 503; (b) send `Token <valid>` (or `Basic <valid>`) → 401; assert the logs contain none of header, payload, signature. The verifier's `PROBE-log503` and `PROBE-lognobearer` are exactly these, pass on HEAD, and fail on M42 / M43.

### OI-2 (Minor): pin case-insensitive scheme acceptance

- **Evidence gap**: the spec edge case now requires `bearer` and `BEARER` to be accepted; no test sends either. M34 and M35 survive.
- **Suggested fix (test-only)**: add `bearer <valid>` and `BEARER <valid>` positive rows next to `test/auth.e2e-spec.ts:85-90` (expect 201 and 1 Catalog call). The verifier's `PROBE-lower` / `PROBE-upper` pass on HEAD and fail on M34 (both) and M35 (lower).

### OI-3 (Note, non-blocking): P1.8 test cannot see a clock Jest does not fake

- `process.uptime()` or an OS clock would bypass `jest.useFakeTimers`. Judged implausible; recorded so a future reviewer knows the test's reach.

---

## Requirement Traceability Update

- **AUTH-01** (non-Bearer edge, now including case): stays **Implementing** — OI-2.
- **AUTH-02** (no-`exp` edge): ready for ✅ Verified (G5 closed by T14).
- **AUTH-03** (AC P1.8 and the no-logging edge): P1.8 ready (G3 closed by T14); stays **Implementing** for the logging edge — OI-1.
- AUTH-04 to AUTH-09: ready for ✅ Verified.

The Verifier does not edit `spec.md`.

---

## Summary

**Overall**: ❌ Not Ready by the letter of the sensor, and final by the user's decision: carry OI-1 and OI-2 as open items. The code at HEAD is correct; the remaining gaps are in the tests.

- **Spec-anchored check**: 27/27 ACs with matching `file:line` evidence; edge cases 3/5 fully evidenced, 2 partially (acceptance half of the scheme rule; non-JOSE log branches).
- **Sensor**: 41/46 killed. Round-2 survivors M31, M32, M33, M36, M38 all killed by T14; 0 regressions; 4 real survivors (M34, M35, M42, M43), 1 equivalent (M37).
- **Gate**: 136 passed (82 unit + 54 e2e), 0 failed, 0 skipped; lint, typecheck and build clean.
