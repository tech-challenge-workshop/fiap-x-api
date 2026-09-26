## Validation: api-hardening (api) — PASS with open items

**Date**: 2026-09-26
**Spec**: `fiap-x-api/.specs/features/api-hardening/spec.md` (HARD-01..08)
**Diff range**: `22a5dc0..88d7f2d` (10 commits, T1–T10), branch `fix/api-hardening`
**Verifier**: independent sub-agent (author ≠ verifier), final round. Leftovers are open items, not fix loops.

**Spec-anchored check**: 21/21 ACs and 3/3 edge cases matched the spec outcome. No spec-precision gaps.
**Gate**: build gate green against my own RustFS 1.0.0 (`STORAGE_TEST_ENDPOINT=http://localhost:39113`): lint, typecheck, unit 150/150, e2e 151/151, 0 skipped, build.
**Sensor**: 30 mutants. 28 killed, 2 survived. Both survivors are equivalent or out of reach of any test (see below).
**Flaky suite**: reproduced 4 times in 160 runs. Root cause found: a port collision with other processes on the loopback address, not a kept-alive socket. It predates the feature. The feature raised exposure by about 40%.

---

## Task Completion

| Task | Status | Notes |
| --- | --- | --- |
| T1 | ✅ Done | Port `'rejected'` + `abortMultipart`; adapter and double |
| T2 | ✅ Done | 400 + abort, best effort |
| T3 | ✅ Done | `findObject` race, unit + e2e |
| T4 | ✅ Done | Unreachable public endpoint on real RustFS |
| T5 | ✅ Done | Case-insensitive `contentType`, stored lowercase |
| T6 | ✅ Done | In-memory Catalog mirrors the Catalog's order: key, then source, then create |
| T7 | ✅ Done | Deviation: `\x7F` replaced by `é`. Judged sound (see HARD-08) |
| T8 | ✅ Done | Token absent on the 503 and `Token <t>` paths |
| T9 | ✅ Done | `bearer` / `BEARER` |
| T10 | ✅ Done | `no-console` on `src/**/*.ts` |

---

## Spec-Anchored Acceptance Criteria

| Req | Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- | --- |
| HARD-01 | P1.1 parts refused | `400` + exact message | `test/complete-upload.e2e-spec.ts:375` `expect(res.body).toEqual(INVALID_PARTS)` (literal `16777216`) | ✅ |
| HARD-01 | P1.2 abort + no request | upload gone; Catalog not called | `:376-380` `catalogCalls()).toBe(0)`, `stillInProgress → toBeUndefined`, no object | ✅ |
| HARD-01 | P1.3 retry | `404 Upload not found` | `:382-389` `.expect(404)`, `again.body toEqual(NOT_FOUND)`, `requestsOf → []` | ✅ |
| HARD-01 | P1.4 other failure | `502 Storage unavailable` | `:569-574` (`complete` rejects `StorageUnavailableError`, unchanged); RustFS near-miss `test/s3-upload-storage.e2e-spec.ts:352` missing bucket → `StorageUnavailableError` | ✅ |
| HARD-01 | Real codes pinned | `EntityTooSmall`, `InvalidPart`, `InvalidPartOrder` → `'rejected'` | `test/s3-upload-storage.e2e-spec.ts:284` `resolves.toBe('rejected')` ×3 cases on RustFS, then abort, `listParts → 'gone'`, second abort resolves | ✅ |
| HARD-02 | P2.1 second key | `200`, same id | `test/complete-upload.e2e-spec.ts:163-178` `.expect(200)`, `second.body toEqual(first.body)` | ✅ |
| HARD-02 | P2.2 no second request | owner total unchanged | `:177-180` `total` unchanged, `requestsOf → [first id]` | ✅ |
| HARD-02 | P2.3 key reused on another upload | `201`, new id | `:182-191` `.expect(201)`, `thirdId not.toBe(first)` | ✅ |
| HARD-02 | Edge: K1 ‖ K2 | one request | `:214-219` `[200,201]`, `ids[0] toBe ids[1]`, `requestsOf → [id]` (both held at `complete`, `arrived === 2`) | ✅ |
| HARD-02 | Mirror of the Catalog | key → source → create | `src/processing-requests/adapters/in-memory-catalog-client.adapter.ts:50-69` vs `processing-catalog/src/application/create-processing-request.use-case.ts:68-84`; unit `in-memory-catalog-client.adapter.spec.ts:185,216` | ✅ |
| HARD-03 | P3.1 any case | `201` | `test/start-upload.e2e-spec.ts:195-215` `VIDEO/QuickTime`, `Video/MP4` → `.expect(201)` | ✅ |
| HARD-03 | P3.2 stored lowercase | lowercase type in storage | double: `:208-212` `startSpy toHaveBeenCalledWith(key, 'video/quicktime'|'video/mp4', 1)`; RustFS: `test/s3-upload-storage.e2e-spec.ts:257` `head.ContentType toBe('video/quicktime')` | ✅ |
| HARD-03 | P3.3 mismatch / parameters | `400` naming `contentType` | `test/start-upload.e2e-spec.ts:251-264` `VIDEO/MP4` for `.mov`, `video/mp4; codecs=avc1` → `CONTENT_TYPE_MESSAGE` | ✅ |
| HARD-04 | P4.1 503 path | `503`, token absent | `test/auth-outage.e2e-spec.ts:105-119` `.expect(503)`, `not.toContain(token)` and each segment | ✅ |
| HARD-04 | P4.2 non-bearer | `401`, header value absent | `test/auth.e2e-spec.ts:201-213` `status 401`, `not.toContain(token)` and each segment | ✅ |
| HARD-05 | P4.3 lint | `console` in `src/` fails lint | `eslint.config.mjs:35-42`. Verified myself: `console.log`/`.error`/`.warn` in `src/uploads/start-upload.service.ts` → `no-console` error; `console.log('x')` in `test/support/upload-flow.ts` → lint exit 0 | ✅ |
| HARD-06 | P5.1 scheme case | `200` | `test/auth.e2e-spec.ts:98-107` `bearer`, `BEARER` → `status 200`, body, one Catalog call; near-miss `:128` `Bearer` alone → 401 | ✅ |
| HARD-07 | P5.2 internal endpoint | start, complete, delete work with the public endpoint unreachable | `test/s3-upload-storage.e2e-spec.ts:396-455` public `http://127.0.0.1:9`; start, findInProgress, listParts, complete, findObject, deleteObject, abort all succeed | ✅ |
| HARD-07 | P5.3 URLs public | part/GET URL on public host | `:413` and `:441` `new URL(...).host toBe('127.0.0.1:9')` | ✅ |
| HARD-08 | P5.4 race | `404 Upload not found` | unit `src/storage/s3-upload-storage.spec.ts:60` `findObject → toBeUndefined` on `NotFound`; `:76` `AccessDenied` → `StorageUnavailableError`; e2e `test/complete-upload.e2e-spec.ts:458-474` `.expect(404)`, `NOT_FOUND` | ✅ |
| HARD-08 | P5.5 key rule | `400` + exact message | `test/complete-upload.e2e-spec.ts:270-296` tab and `café` → exact message, no storage or Catalog call; near-misses `:301` space → 201, `:264` 255 chars → 201 | ✅ |

**Edge cases**
- [x] K1 ‖ K2 on one upload → one request (above).
- [x] Abort fails → still `400`, log holds only the error name: `test/complete-upload.e2e-spec.ts:418-426` `toContain('AbortFailedError')`, `not.toContain('abort detail' | 'sources/' | storageUploadId)`, upload left in progress.
- [x] 255 printable characters accepted: `:264`.

---

## Discrimination Sensor

Run in a scratch `git worktree` at `88d7f2d` (never `git stash`). Each mutant ran unit + full e2e against RustFS, then was reverted with `git checkout`. Real tree `git status --porcelain` matched the (empty) baseline afterwards.

| # | Mutation | Killed by |
| --- | --- | --- |
| M1a | Adapter: rejected codes → `throw unavailable` (502) | 3 RustFS refusal cases ✅ |
| M1b | Service: `'rejected'` → `502` | 2 HARD-01 e2e ✅ |
| M2 | Skip the abort | 2 HARD-01 e2e ✅ |
| M3 | Log the abort error message | abort-failure e2e ✅ |
| M3b | Let the abort error propagate | abort-failure e2e ✅ |
| M4 | In-memory Catalog: source before key | unit "checks the key first" ✅ (e2e does not see it) |
| M4b | No source dedup | unit + 2 HARD-02 e2e ✅ |
| M4c | Source dedup ignores owner | unit owner test ✅ |
| M5 | Store the raw `contentType` | 2 e2e + RustFS `ContentType` ✅ |
| M5b | DTO compares case-sensitively | 2 e2e ✅ |
| M5c | DTO strips parameters | `codecs=avc1` e2e ✅ |
| M6 | Log the token on 503 | outage e2e ✅ |
| M6b | Log the header on no-bearer | `Token <t>` e2e ✅ |
| M7 | Drop the `i` flag | `bearer`, `BEARER` e2e ✅ |
| M8 | Presign with the internal client | HARD-07 + 2 older RustFS cases ✅ |
| M8b | Calls through the public client | HARD-07 ✅ |
| M8c | Abort through the presigner | HARD-07 ✅ |
| M9 | Remove `isNotFound` | unit race ✅ (e2e uses the double) |
| M10 | `PRINTABLE_ASCII` → length only | tab and `é` e2e ✅ |
| M10b | Skip the `PRINTABLE_ASCII` check | 3 e2e ✅ |
| M12 | Double: no min part size | 3 unit + 2 e2e ✅ |
| M12b | Double: no order rule | unit ✅ |
| M13 / b / c | Adapter drops `InvalidPartOrder` / `EntityTooSmall` / `InvalidPart` | matching RustFS case each ✅ |
| M14 | Abort without `NoSuchUpload` guard | 3 RustFS cases ✅ |
| M15 | Double abort is a no-op | unit + e2e ✅ |
| M16 | Message says `PART_SIZE_BYTES / 2` | 2 e2e ✅ |
| M18 | `'rejected'` falls through without 400 | 2 e2e ✅ |
| M19 | Double discards the upload on rejection | 4 unit + 1 e2e ✅ |
| M11 | Delete the `no-console` rule (with a `console.log` in `src/`) | ❌ **Survived**: lint exits 0. No test covers the lint config. This is inherent to a config guard; see open item 3 |
| M17 | `PRINTABLE_ASCII` admits DEL (`[\x20-\x7F]`) | ❌ **Survived, equivalent at the HTTP boundary**: probed on Node 22.22.3, the client throws `ERR_INVALID_CHAR` and the server answers a raw DEL with a bare `400 Bad Request` before any route runs |

**Sensor depth**: expanded (30 mutants). **Result**: 28/30 killed. The 2 survivors cannot be killed by a behaviour test through HTTP.

---

## Code Quality

| Principle | Status |
| --- | --- |
| Minimum code | ✅ Three behaviour changes, each a few lines |
| Surgical changes | ✅ |
| No scope creep | ✅ |
| Matches patterns | ✅ `isRejectedParts` mirrors `isNoSuchUpload`; `'rejected'` follows `'gone'` |
| Asserted values match the spec | ✅ Exact messages and statuses, literal `16777216` |
| Per-layer coverage | ✅ Double and adapter unit, RustFS integration, e2e per AC |
| Every test maps to a requirement | ✅ |
| Guidelines | none, so strong defaults apply |

**Test integrity**: `git diff 22a5dc0..88d7f2d` removes no line from any test file. Unit 138 → 150 and e2e 126 → 151; I measured both at `22a5dc0` in a scratch worktree. No skips.

**T7 deviation (`\x7F` → `é`)**: sound. DEL cannot reach the guard through Node's HTTP stack, so a DEL test would only prove Node's parser. The tab (a control character) and `é` (byte 0xE9, decoded as latin1 U+00E9) are two representatives of "outside printable ASCII" that differ in kind (L-006). The spec's AC P5.5 is generic, so it is fully met. Only the task's literal Done-when differs, and the task records that.

---

## Flaky suite: `test/complete-upload.e2e-spec.ts`

**Reproduced**: 2/60 plain runs, plus 2/100 runs with a diagnostic hook (4/160, about 2.5%). All 4 failed on the wrong status or body:
- `expected 404, got 401`;
- `{}` body where the 404 JSON was expected;
- `expected 201, got 401`;
- `expected 201, got 404`.

**Root cause (proven)**: the requests never reached the Nest app. A throwaway `setupFilesAfterEnv` hook logged every response that lacked `X-Powered-By: Express`. The two failing diagnostic runs show:
- `url=http://127.0.0.1:49155/uploads … status=404 content-type text/plain "Not found"`. That port is the Traycer host's listener (`lsof`: `traycer-h 127.0.0.1:49155`).
- `url=http://127.0.0.1:49818/uploads … status=401 {"type":"error","error":{"type":"authentication_error",…}}`. That port is a VS Code helper (`Code H 127.0.0.1:49818`).

The mechanism has three parts:
1. supertest calls `app.listen(0)` for every request (`node_modules/supertest/lib/test.js:63`), and that binds the **wildcard** address.
2. It then dials `http://127.0.0.1:<port>` (`:68`).
3. On macOS the ephemeral allocator sometimes hands the wildcard socket a port that another local process already holds on `127.0.0.1` specifically. The loopback connection then goes to that more specific listener.

The rate fits this. The rate per `listen(0)` is 4 / (160 × 77) ≈ 3.2e-4. Seven foreign `127.0.0.1` listeners sit in the 16 384-port ephemeral range: 7 / 16 384 ≈ 4.3e-4.

**Not a kept-alive socket**. superagent sets `agent: false` (`node_modules/superagent/lib/node/index.js:162`), so connections are not pooled. Every response in the capture shows `connection: close`.

**Did the feature make it worse?** It did not cause the flake, but it raised the exposure. It predates the batch (the author saw it at `e5b6e00`). The suite's `listen(0)` calls grew from 55 to 77 (+40%): I counted them with a hook at `22a5dc0` and at `88d7f2d`. The whole e2e run grew from 204 to 236 listens. At the measured rate that is about a 7% chance that a full e2e run flakes on this machine. The rate depends on the machine: it depends on which local processes hold ephemeral `127.0.0.1` ports.

**Recommended fix** (test-only, all e2e suites):
- Bind the app to the same address the client dials, before any request. In each `beforeEach`/`beforeAll`, after `await app.init()`, add `await app.listen(0, '127.0.0.1')`. Keep `request(app.getHttpServer())`.
- supertest then sees an address, so it does not call `listen(0)` again. It dials the port that was really bound on `127.0.0.1`, which the kernel will not share with another `127.0.0.1` listener. `app.close()` in `afterEach` stays as it is.
- Centralise it in one helper (for example `test/support/listen.ts`) and use it in the 12 e2e suites.
- To verify, loop `complete-upload` 200 times with the diagnostic hook: expect 0 responses without `X-Powered-By`.

---

## Open items (Validar depois), ranked

1. **[Medium, test infra, pre-existing] Wrong-server flake in every e2e suite.**
   - Where: every `request(app.getHttpServer())` without a prior `listen` on `127.0.0.1`, for example `test/support/upload-flow.ts:24`, `:66` and `test/complete-upload.e2e-spec.ts:62-82`.
   - Failure scenario: a supertest `listen(0)` gets port 49155; the confirm is answered by the Traycer host with `404 Not found` and the test fails.
   - Fix: as above.
2. **[Low] `PRINTABLE_ASCII` upper bound (`\x7E`) is not pinned (M17).**
   - Where: `src/uploads/complete-upload.service.ts:22`.
   - Failure scenario: none through HTTP today. The rule would matter only if the service were reached without Node's parser, for example from a queue consumer.
   - Optional: a unit test calling `CompleteUploadService.execute('alice', uuid, 'a\x7F')`, expecting the exact 400.
3. **[Low] The `no-console` guard itself is unguarded (M11), and it misses aliases.**
   - Where: `eslint.config.mjs:35-42`.
   - Failure scenario 1: someone deletes the rule and adds `console.log(url)`; the gate stays green.
   - Failure scenario 2: `globalThis.console.log(url)` in `src/` passes lint today (verified), and so does `process.stdout.write(url)`. The spec's P4.3 says "any `console` call".
   - Optional fixes:
     - add `no-restricted-properties` for `globalThis.console`, or `no-restricted-syntax` on `MemberExpression[object.name='console']`;
     - add a tiny test that loads the ESLint config and asserts `no-console` is `error` for a `src/` file.
4. **[Info] A retry after a failed abort answers `400` again, not `404`.**
   - Where: `src/uploads/complete-upload.service.ts:87-92` with `:124-131`.
   - This matches the spec's edge case: the 1-day rule cleans up. AC P1.3's `404` holds only after a successful abort. It is untested but consistent, so no action is needed.
5. **[Info] `toLowerCase()` folds U+212A (Kelvin sign) to `k`.**
   - Where: `src/uploads/start-upload.dto.ts:36`.
   - `video/quicKtime` is accepted for `.mov`, but it is stored as ASCII `video/quicktime`, so nothing downstream sees the odd value. This is harmless. `toLowerCase()` on an ASCII-only check (for example `/^[\x20-\x7E]+$/`) would close it if anyone cares.

---

## Gate Check

- **Gate command**: `npm run lint && npm run typecheck && npm test && npm run test:e2e && npm run build`, with `STORAGE_TEST_ENDPOINT=http://localhost:39113` (my own `rustfs/rustfs:1.0.0`, now removed).
- **Result**: unit 150 passed; e2e 151 passed; 0 failed; 0 skipped; lint, typecheck and build green.
- **Test count before feature** (`22a5dc0`, measured): unit 138, e2e 126.
- **Test count after**: unit 150 (+12), e2e 151 (+25).
- **Skipped**: none.

---

## Requirement Traceability Update

| Requirement | Previous | New |
| --- | --- | --- |
| HARD-01 | Implementing | ✅ Verified |
| HARD-02 | Implementing | ✅ Verified |
| HARD-03 | Implementing | ✅ Verified |
| HARD-04 | Implementing | ✅ Verified |
| HARD-05 | Implementing | ✅ Verified (open item 3) |
| HARD-06 | Implementing | ✅ Verified |
| HARD-07 | Implementing | ✅ Verified |
| HARD-08 | Implementing | ✅ Verified (open item 2) |

---

## Lessons signal

Signal exists: 2 surviving mutants and 1 diagnosed flake. I did not run `lessons.py`, because that is the orchestrator's action on the real tree. Candidates:

- **Flake (test infra):** "An e2e server must listen on the exact address the client dials. supertest's `listen(0)` binds the wildcard address and dials `127.0.0.1`, so another process's loopback listener can answer."
  - Evidence: DIAG capture, `127.0.0.1:49155` / `:49818`.
  - Scope: `test`.
- **M11 (config guard):** "A guard that lives in lint config needs its own check (a config assertion or a restricted-syntax rule for aliases), or deleting it passes the gate."
  - Evidence: `eslint.config.mjs:35-42`.
  - Scope: `lint`.
  - This corroborates L-011.
- **M17 (equivalent):** "Before pinning a character rule at the HTTP layer, probe what the HTTP stack lets through. Pin the unreachable part at the unit layer or accept it as equivalent."
  - Evidence: `src/uploads/complete-upload.service.ts:22`.
  - Scope: `uploads`.
- **Positive signal, no lesson needed:** L-010 and L-012 were applied and held. M1a, M8, M8b and M8c were all killed by the double's rejection rules and the unreachable public endpoint.
