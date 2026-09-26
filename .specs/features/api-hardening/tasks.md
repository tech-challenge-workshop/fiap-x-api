# API Hardening Tasks — api

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.** (In this project's sessions the skill is not registered by name; the user has authorized reading it from `.agents/skills/tlc-spec-driven/` by path.)

---

**Design**: `.specs/features/api-hardening/design.md`
**Status**: Draft

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec - confirm before Execute. Guidelines found: none, so strong defaults apply. Same layers and commands as `upload-download/tasks.md` (S6).
>
> Candidate lessons applied as guidance:
> - L-003/L-004: test a rejection with an input only that rule rejects.
> - L-008/L-009: assert must-not-log on every logging path.
> - L-010: a double raises what the real adapter raises.
> - L-011: capture every output channel or enforce it by lint.
> - L-012: two endpoints in a routing test must reach different servers.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| Storage port + in-memory double | unit | Every new outcome (`'rejected'` for undersized, wrong-ETag and out-of-order parts; abort; abort of an absent upload) | `src/storage/*.spec.ts` | `npm test` |
| S3 adapter | integration + unit | Against real RustFS: the three refusal codes → `'rejected'`, abort, and routing with an unreachable public endpoint. With a fake sender: the `findObject` race | `test/s3-upload-storage.e2e-spec.ts`, `src/storage/*.spec.ts` | both |
| Services + controllers | e2e | Every AC and edge case in the spec, with the exact message; no second request; no token or URL in logs | `test/*.e2e-spec.ts` | `npm run test:e2e` |
| In-memory Catalog client | unit | Same outcomes as the Catalog's HARD-09 | `src/processing-requests/adapters/*.spec.ts` | `npm test` |
| Lint config | none | Build gate plus a literal negative (a `console.log` in `src/` fails lint) | `eslint.config.mjs` | build gate |

## Gate Check Commands

> Generated from codebase - confirm before Execute. The S3 adapter suite needs RustFS: `docker run -d -p <port>:9000 -e RUSTFS_ACCESS_KEY=fiapx-dev -e RUSTFS_SECRET_KEY=fiapx-dev-secret rustfs/rustfs:1.0.0` and `STORAGE_TEST_ENDPOINT=http://localhost:<port>`; with it set, nothing may skip.

| Gate Level | When to Use | Command |
| --- | --- | --- |
| Quick | Unit-only tasks | `npm test` |
| Full | Tasks with e2e/integration tests | `npm test && npm run test:e2e` |
| Build | Last task of a phase | `npm run lint && npm run typecheck && npm test && npm run test:e2e && npm run build` |

---

## Execution Plan

### Phase 1: Storage tells rejection from failure

```
T1 -> T2
T3
T4
```

### Phase 2: Contract and guarantees

```
T5
T6
T7
T8
T9
T10
```

---

## Task Breakdown

### Phase 1: Storage tells rejection from failure

### T1: Let the storage port reject a completion and abort an upload

**What**: `complete` can return `'rejected'`; add `abortMultipart`. The S3 adapter maps `EntityTooSmall`, `InvalidPart` and `InvalidPartOrder` to `'rejected'` and aborts through the internal client, ignoring `NoSuchUpload`. The in-memory double rejects the same way: a non-final part under 5 242 880 bytes, a wrong ETag, or parts out of order. A rejected upload stays in progress until it is aborted.
**Where**: `src/storage/upload-storage.port.ts` (+ `s3-upload-storage.ts`, `in-memory-upload-storage.ts`)
**Depends on**: None
**Reuses**: `isNoSuchUpload`, `call`, the `'gone'` pattern
**Requirement**: HARD-01

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] RustFS: 1 byte then 4 MiB → `'rejected'`; a wrong ETag → `'rejected'`; out of order → `'rejected'`; after `abortMultipart` no upload is in progress; aborting again is not an error. A bucket that does not exist still throws `StorageUnavailableError` (the near-miss)
- [x] Double: the same three rejections, plus 5 MiB non-final parts complete. Existing tests that relied on the double's plain `Error` are listed and updated without weakening
- [x] Full gate passes

**Tests**: unit + integration
**Gate**: full

**Status**: ✅ Complete. Unit 138 → 144, e2e 126 → 131, 0 skipped with `STORAGE_TEST_ENDPOINT` set.
- `src/storage/in-memory-upload-storage.spec.ts` adds 6 tests: 1 byte then 4 MiB and 5 242 879 bytes then 1 byte → `'rejected'`; wrong ETag → `'rejected'`; out of order (both parts ≥ 5 MiB, so only the order rule applies) → `'rejected'`; each leaves the upload in progress; 5 MiB non-final parts complete; abort discards and a second abort resolves.
- `test/s3-upload-storage.e2e-spec.ts` adds 4 RustFS cases (the three refusals, each followed by abort, no upload in progress, `listParts` → `'gone'`, second abort resolves; the missing bucket near-miss) and `abortMultipart` to the unreachable-storage table.
- Existing tests changed: none. No test relied on the double's plain `Error`, and no existing flow sends a non-final part under 5 MiB (`uploadParts` sends 16 MiB parts; the other flows send one part).
- Negatives (scratch copy, restored): without the `isRejectedParts` branch 3 RustFS tests fail; without the `NoSuchUpload` guard in `abortMultipart` 3 fail; mapping every error to `'rejected'` fails the near-miss and the unreachable `complete`. In the double, dropping the ETag, order or size rule fails its own test(s), and a minimum of 5 MiB + 1 fails the 5 MiB near-miss.

---

### T2: Answer invalid parts with a 400 and discard the upload

**What**: On `'rejected'`, `CompleteUploadService` aborts the upload (best effort, logging only the error name) and throws `400 Uploaded parts are invalid: every part except the last must be 16777216 bytes`.
**Where**: `src/uploads/complete-upload.service.ts`
**Depends on**: T1
**Reuses**: `PART_SIZE_BYTES`, `test/complete-upload.e2e-spec.ts`, `test/support/upload-flow.ts`
**Requirement**: HARD-01

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Undersized parts → `400` with the exact message; the Catalog receives no call; a second confirmation → `404 Upload not found`
- [x] An abort that throws still gives `400`, and the log holds the error name only
- [x] Any other completion failure → `502 Storage unavailable` (unchanged)
- [x] Full gate passes

**Tests**: e2e
**Gate**: full

**Status**: ✅ Complete. E2e 131 → 134, unit 144 unchanged, 0 skipped.
- `test/complete-upload.e2e-spec.ts` adds a `parts storage refuses (HARD-01)` group: 1 byte then 4 MiB → `400` with the exact message, no Catalog call, no upload in progress and no object, then `404 Upload not found`; the near-miss 5 MiB then 1 byte → `201`; an abort that throws an error named `AbortFailedError` → still `400`, the log holds the name and neither the message, the key nor the storage upload id.
- The `502` criterion is the existing `answers 502 when storage fails in %s` case with `complete` rejecting `StorageUnavailableError`; it still passes unchanged.
- The message is built from `PART_SIZE_BYTES`; the tests assert the literal `16777216`.
- Existing tests changed: none.
- Negatives (scratch copy, restored): without the abort call 2 tests fail; logging the error message too, or letting the abort error propagate, fails the abort-failure test; `PART_SIZE_BYTES / 2` in the message fails 2 tests.

---

### T3: Pin the `findObject` race

**What**: A unit test drives `S3UploadStorage.findObject` with a fake `S3Sender` that lists a key and answers the head with `NotFound`, expecting `undefined`. It also checks that any other head error is `StorageUnavailableError`. An e2e proves the service answers `404 Upload not found` when the object vanishes.
**Where**: `src/storage/s3-upload-storage.spec.ts` (new)
**Depends on**: None
**Reuses**: The `S3Sender` constructor injection
**Requirement**: HARD-08

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Removing the `isNotFound` branch at `s3-upload-storage.ts:219-223` turns this test red
- [x] The e2e for the vanished object answers `404`
- [x] Full gate passes

**Tests**: unit + e2e
**Gate**: full

**Status**: ✅ Complete. Unit 144 → 147, e2e 134 → 135, 0 skipped.
- `src/storage/s3-upload-storage.spec.ts` (new) drives `findObject` through a fake `S3Sender` that lists the key, then answers the head: success → the object (the contrast case); the SDK's `NotFound` (404) → `undefined`; `AccessDenied` (403) → `StorageUnavailableError` with `Storage unavailable (AccessDenied)`.
- `test/complete-upload.e2e-spec.ts` adds a case where the object is deleted while `findObject` reads it: `404 Upload not found`, no Catalog call, no request.
- The branch now sits at `s3-upload-storage.ts:241-244` after T1's additions.
- Existing tests changed: none.
- Negatives (scratch copy, restored): removing the `isNotFound` branch fails the `NotFound` test; treating every head error as absence fails the `AccessDenied` test; a `502` for a missing object in the service fails the new e2e (and two older 404 cases).

---

### T4: Prove the internal and public clients are separate

**What**: A RustFS integration case builds `S3UploadStorage` with the real internal endpoint and a public endpoint where nothing listens (`http://127.0.0.1:9`). Start, list, complete, abort, head and delete must succeed, and every presigned URL must name `127.0.0.1:9`.
**Where**: `test/s3-upload-storage.e2e-spec.ts`
**Depends on**: None
**Reuses**: The suite's RustFS setup
**Requirement**: HARD-07

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Swapping the two clients in the adapter turns this case red
- [x] Build gate passes

**Tests**: integration
**Gate**: build

**Status**: ✅ Complete. E2e 135 → 136, unit 147 unchanged, 0 skipped with `STORAGE_TEST_ENDPOINT` set; lint, typecheck and build green.
- `test/s3-upload-storage.e2e-spec.ts` adds one RustFS case: `S3UploadStorage` with the real internal endpoint and `http://127.0.0.1:9` as the public one. Start, `findInProgress`, `listParts`, `complete`, `findObject` (the head), `deleteObject` and `abortMultipart` succeed; the part URL and the GET URL name `127.0.0.1:9`.
- The part is sent with the raw SDK client, since the part URL points where nothing listens.
- Existing tests changed: none.
- Negatives (scratch copy, restored): swapping the two clients in `fromConfig` fails the case with `StorageUnavailableError` on the first call; presigning on the internal endpoint fails it with host `127.0.0.1:39111` instead of `127.0.0.1:9`; calling on the public endpoint fails it with `StorageUnavailableError`.

---

### Phase 2: Contract and guarantees

### T5: Accept `contentType` in any case and store it lowercase

**What**: `matchesExtension` compares the value in lowercase, and `StartUploadService` passes it to `startMultipart` in lowercase.
**Where**: `src/uploads/start-upload.dto.ts` (+ `start-upload.service.ts`)
**Depends on**: None (Phase 1 complete)
**Reuses**: `test/start-upload.e2e-spec.ts`
**Requirement**: HARD-03

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `.mov` with `VIDEO/QuickTime` → `201`, and `.mp4` with `Video/MP4` → `201`
- [x] Storage receives the lowercase type: asserted on the double, and on RustFS through the head's `ContentType`
- [x] `video/mp4` for a `.mov` → `400` naming `contentType`; `video/mp4; codecs=avc1` → `400`
- [x] Full gate passes

**Tests**: e2e
**Gate**: full

**Status**: ✅ Complete. E2e 136 → 141, unit 147 unchanged, 0 skipped with `STORAGE_TEST_ENDPOINT` set.
- `test/start-upload.e2e-spec.ts` adds `.mov` + `VIDEO/QuickTime` and `.mp4` + `Video/MP4` → `201`, with `startMultipart` receiving `video/quicktime` and `video/mp4`. The double discards the type, so the argument is what it can show. The `400` table gains `VIDEO/MP4` for a `.mov` (a second mismatch representative) and `video/mp4; codecs=avc1`.
- `test/s3-upload-storage.e2e-spec.ts` runs `StartUploadService` on the RustFS adapter with `VIDEO/QuickTime`, sends the part, completes, and reads `video/quicktime` from the head's `ContentType`. RustFS 1.0.0 keeps the case it is given (probed: `VIDEO/QuickTime` comes back unchanged), so the check discriminates.
- Existing tests changed: none.
- Negatives (scratch copy, restored): comparing without lowercasing fails the two `201` cases; passing the raw type to storage fails those two and the RustFS case; stripping parameters before comparing fails the `codecs=avc1` case.

---

### T6: One upload, one request

**What**: `InMemoryCatalogClient` returns `replayed` for an owner's known source under a new key, mirroring the Catalog's HARD-09. End-to-end tests cover the second-key flow.
**Where**: `src/processing-requests/adapters/in-memory-catalog-client.adapter.ts`
**Depends on**: None (Phase 1 complete)
**Reuses**: `test/complete-upload.e2e-spec.ts`, `test/support/upload-flow.ts`
**Requirement**: HARD-02

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Unit: known source + new key → `replayed` with the same id; known key + other source → `conflict` (unchanged)
- [x] E2e:
  - K1 → `201`
  - K2 on the same upload → `200` with the same id, and the owner's total is unchanged
  - K2 on another upload → `201`
  - K1 and K2 concurrently on one upload → one request, and both responses carry its id
- [x] Full gate passes

**Tests**: unit + e2e
**Gate**: full

**Status**: ✅ Complete. Unit 147 → 150, e2e 141 → 143, 0 skipped with `STORAGE_TEST_ENDPOINT` set.
- `InMemoryCatalogClient.createProcessingRequest` follows the Catalog's verified contract. The key is checked first: the same source → `replayed`; another source → `conflict`. An unbound key for a source the owner already has → `replayed` with the stored record, and nothing is written. Otherwise → `created`.
- `in-memory-catalog-client.adapter.spec.ts` adds 3 tests:
  - A known source under a new key → the same record, `replayed`; the total stays 1, and the new key still creates for another source.
  - A key bound to another source → `conflict`, even when the new source already has a request.
  - Another owner's request for the same source is not replayed.
- `test/complete-upload.e2e-spec.ts` adds a `one upload, one request (HARD-02)` group:
  - K1 → `201`; K2 on the same upload → `200` with the same body, and the owner's total unchanged; K2 on another upload → `201` with a new id.
  - K1 and K2 held at `complete` until both arrive → statuses `200` and `201`, one id, one request.
- Existing tests changed: none.
- Negatives (scratch copy, restored):
  - Without the source check, the new unit test and both e2e tests fail.
  - Checking the source before the key fails the conflict-first test.
  - Ignoring the owner in the source check fails the owner test.
  - Binding the new key on replay fails the unit replay test and both e2e tests.

---

### T7: Pin the key's character rule

**What**: E2e tests for `Idempotency-Key` outside printable ASCII.
**Where**: `test/complete-upload.e2e-spec.ts`
**Depends on**: None (Phase 1 complete)
**Reuses**: The existing `400` key tests
**Requirement**: HARD-08

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] A key with a tab or `\x7F` → `400 Idempotency-Key must be 1 to 255 printable ASCII characters`, and storage is not completed (`\x7F` replaced by a non-ASCII byte, see Status)
- [x] Near-misses: a 255-character printable key → accepted; a key containing a space → accepted
- [x] Removing `PRINTABLE_ASCII` turns a test red
- [x] Full gate passes

**Tests**: e2e
**Gate**: full

**Status**: ✅ Complete. E2e 143 → 146, unit 150 unchanged, 0 skipped with `STORAGE_TEST_ENDPOINT` set.
- `test/complete-upload.e2e-spec.ts` adds:
  - keys `key\twith-tab` and `café` → `400` with the exact message, no storage or Catalog call, and the upload still in progress;
  - a key with a space → `201`, passed to the Catalog verbatim.
- The 255-character near-miss is the existing `accepts exactly 255` case.
- Deviation: `\x7F` cannot reach the API. Probed on this Node:
  - its HTTP client refuses to send it (`ERR_INVALID_CHAR`);
  - its HTTP server answers a raw `\x7F` with a bodyless `400 Bad Request` before any route runs.

  A test for it would prove Node's parser, not the rule, and would pass without `PRINTABLE_ASCII`. So `é` (byte 0xE9) is the second character outside printable ASCII, next to the tab.
- Existing tests changed: none.
- Negatives (scratch copy, restored):
  - Removing the `PRINTABLE_ASCII` check fails 3 tests (both new `400` cases and the existing over-255 case).
  - A length-only rule fails both new `400` cases.
  - Excluding the space (`\x21-\x7E`) fails the space near-miss.
- Found while gating: `complete-upload.e2e-spec.ts` fails intermittently on a request answered with the wrong status (401 or 404 where the flow expects 404, 502 or 400). This predates the feature: at `e5b6e00` it failed 1 run in 60 (`expected 404, got 401`). Here it failed 3 runs in about 70. It is not caused by this task. The cause is not diagnosed; a stale kept-alive socket to an earlier test's app is the guess.

---

### T8: The token never reaches the log on the 503 and non-bearer paths

**What**: Log assertions on `auth-outage` (IdP down, valid-shaped token of an unknown key) and on `Token <valid token>`.
**Where**: `test/auth-outage.e2e-spec.ts` (+ `test/auth.e2e-spec.ts`)
**Depends on**: None (Phase 1 complete)
**Reuses**: `CapturingLogger`, the Verifier's probes `PROBE-log503` and `PROBE-lognobearer` (S5)
**Requirement**: HARD-04

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `503`, and the captured log does not contain the token
- [x] `401` for `Token <token>`, and the captured log does not contain the token
- [x] Adding the token to either log line turns its test red
- [x] Full gate passes

**Tests**: e2e
**Gate**: full

**Status**: ✅ Complete. E2e 146 → 148, unit 150 unchanged, 0 skipped with `STORAGE_TEST_ENDPOINT` set.
- `test/auth-outage.e2e-spec.ts` now installs `test/support/CapturingLogger` in `beforeEach`; this is setup only. A new test sends a token of a key the app never fetched while the provider is down. It gets `503`; the log contains `Authentication unavailable: IdentityProviderUnavailableError`; the log holds neither the token nor any of its three segments.
- `test/auth.e2e-spec.ts` adds `Token <valid token>` → `401`. It reuses the suite's own capturing logger. The log contains `Authentication rejected: no bearer token` and neither the token nor any segment.
- Existing tests changed: none.
- Negatives (scratch copy, restored):
  - Appending the token to the `503` line fails the outage test; appending only its signature fails it too.
  - Appending the `Authorization` header to the no-bearer line fails the new `Token` test. The older auth log test did not catch this, since it sends only `Bearer` headers.

---

### T9: Pin the case-insensitive bearer scheme

**What**: E2e tests with `bearer <token>` and `BEARER <token>`.
**Where**: `test/auth.e2e-spec.ts`
**Depends on**: None (Phase 1 complete)
**Reuses**: The existing authenticated-call test
**Requirement**: HARD-06

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Both forms get `200` on `GET /processing-requests`
- [x] Near-miss: `Bearer` with no token → `401`
- [x] Dropping the `i` flag of `BEARER` turns a test red
- [x] Full gate passes

**Tests**: e2e
**Gate**: full

**Status**: ✅ Complete. E2e 148 → 151, unit 150 unchanged, 0 skipped with `STORAGE_TEST_ENDPOINT` set.
- `test/auth.e2e-spec.ts`:
  - `bearer <token>` and `BEARER <token>` → `200`, the empty page and one Catalog call.
  - A new row in the `401` table: the header `Bearer` alone → `401 Unauthorized`, no Catalog call. The existing `'Bearer '` row has a trailing space, so it is a different input.
- Existing tests changed: none (one row added to the `401` table).
- Negatives (scratch copy, restored):
  - Dropping the `i` flag fails both new `200` cases.
  - A pattern that lets `Bearer` through with an empty token still gives `401`, because verifying `''` throws a JOSE error; only the log line differs. That mutant is equivalent for the spec's outcome.

---

### T10: Bar console output from production code

**What**: Add an `eslint.config.mjs` block for `src/**/*.ts` with `'no-console': 'error'`.
**Where**: `eslint.config.mjs`
**Depends on**: None (Phase 1 complete)
**Reuses**: The existing lint gate
**Requirement**: HARD-05

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `npm run lint` passes on the tree
- [x] Literal negative: in a scratch copy, `console.log(url)` in `start-upload.service.ts` makes `npm run lint` fail naming `no-console`; the same line in `test/` does not
- [x] Build gate passes

**Tests**: none
**Gate**: build

**Status**: ✅ Complete. Unit 150 and e2e 151 unchanged, 0 skipped with `STORAGE_TEST_ENDPOINT` set. Lint, typecheck and build are green.
- `eslint.config.mjs` ends with a block for `src/**/*.ts` setting `'no-console': 'error'`. `src/` had no `console` call.
- Literal negative (scratch copy, restored):
  - `console.log(url)` for each part URL in `StartUploadService.execute` → `npm run lint` exits 1 with `60:7 error Unexpected console statement no-console`.
  - The same line in `test/support/upload-flow.ts` → `npm run lint` exits 0.

---

## Phase Execution Map

```
Phase 1 (T1 T2 T3 T4) then Phase 2 (T5 T6 T7 T8 T9 T10)
```

10 tasks: **Phase 1** (4) and **Phase 2** (6). Cross-repository order: `processing-catalog` first, then this repository.

---

## Task Granularity Check

| Task | Scope | Status |
| --- | --- | --- |
| T1: Port + both adapters | 1 port contract | ⚠️ OK - cohesive; a port change must land with its implementations to compile |
| T2: Service rejection branch | 1 function | ✅ Granular |
| T3: `findObject` race test | 1 test file | ✅ Granular |
| T4: Routing test | 1 test case | ✅ Granular |
| T5: `contentType` case | 1 validator + 1 call site | ⚠️ OK - cohesive |
| T6: In-memory Catalog + e2e | 1 adapter | ✅ Granular |
| T7: Key character tests | 1 test group | ✅ Granular |
| T8: Log assertions | 2 test cases in two auth suites | ⚠️ OK - cohesive; one requirement, the suite that already stops the IdP plus the one that sends headers |
| T9: Bearer case tests | 1 test group | ✅ Granular |
| T10: Lint rule | 1 config block | ✅ Granular |

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows (within phase) | Status |
| --- | --- | --- | --- |
| T1 | None | — | ✅ Match |
| T2 | T1 | T1 → T2 | ✅ Match |
| T3 | None | — | ✅ Match |
| T4 | None | — | ✅ Match |
| T5 | None (Phase 1 complete) | — | ✅ Match |
| T6 | None (Phase 1 complete) | — | ✅ Match |
| T7 | None (Phase 1 complete) | — | ✅ Match |
| T8 | None (Phase 1 complete) | — | ✅ Match |
| T9 | None (Phase 1 complete) | — | ✅ Match |
| T10 | None (Phase 1 complete) | — | ✅ Match |

No task depends on a later phase.

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| --- | --- | --- | --- | --- |
| T1 | Storage port + double + S3 adapter | unit + integration | unit + integration | ✅ OK |
| T2 | Services + controllers | e2e | e2e | ✅ OK |
| T3 | S3 adapter (+ service path) | unit (+ e2e) | unit + e2e | ✅ OK |
| T4 | S3 adapter | integration | integration | ✅ OK |
| T5 | Services + controllers | e2e | e2e | ✅ OK |
| T6 | In-memory Catalog client + services | unit + e2e | unit + e2e | ✅ OK |
| T7 | Services + controllers | e2e | e2e | ✅ OK |
| T8 | Services + controllers (auth) | e2e | e2e | ✅ OK |
| T9 | Services + controllers (auth) | e2e | e2e | ✅ OK |
| T10 | Lint config | none | none | ✅ OK |
