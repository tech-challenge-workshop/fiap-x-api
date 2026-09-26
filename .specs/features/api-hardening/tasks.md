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

- [ ] RustFS: 1 byte then 4 MiB → `'rejected'`; a wrong ETag → `'rejected'`; out of order → `'rejected'`; after `abortMultipart` no upload is in progress; aborting again is not an error. A bucket that does not exist still throws `StorageUnavailableError` (the near-miss)
- [ ] Double: the same three rejections, plus 5 MiB non-final parts complete. Existing tests that relied on the double's plain `Error` are listed and updated without weakening
- [ ] Full gate passes

**Tests**: unit + integration
**Gate**: full

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

- [ ] Undersized parts → `400` with the exact message; the Catalog receives no call; a second confirmation → `404 Upload not found`
- [ ] An abort that throws still gives `400`, and the log holds the error name only
- [ ] Any other completion failure → `502 Storage unavailable` (unchanged)
- [ ] Full gate passes

**Tests**: e2e
**Gate**: full

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

- [ ] Removing the `isNotFound` branch at `s3-upload-storage.ts:219-223` turns this test red
- [ ] The e2e for the vanished object answers `404`
- [ ] Full gate passes

**Tests**: unit + e2e
**Gate**: full

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

- [ ] Swapping the two clients in the adapter turns this case red
- [ ] Build gate passes

**Tests**: integration
**Gate**: build

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

- [ ] `.mov` with `VIDEO/QuickTime` → `201`, and `.mp4` with `Video/MP4` → `201`
- [ ] Storage receives the lowercase type: asserted on the double, and on RustFS through the head's `ContentType`
- [ ] `video/mp4` for a `.mov` → `400` naming `contentType`; `video/mp4; codecs=avc1` → `400`
- [ ] Full gate passes

**Tests**: e2e
**Gate**: full

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

- [ ] Unit: known source + new key → `replayed` with the same id; known key + other source → `conflict` (unchanged)
- [ ] E2e:
  - K1 → `201`
  - K2 on the same upload → `200` with the same id, and the owner's total is unchanged
  - K2 on another upload → `201`
  - K1 and K2 concurrently on one upload → one request, and both responses carry its id
- [ ] Full gate passes

**Tests**: unit + e2e
**Gate**: full

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

- [ ] A key with a tab or `\x7F` → `400 Idempotency-Key must be 1 to 255 printable ASCII characters`, and storage is not completed
- [ ] Near-misses: a 255-character printable key → accepted; a key containing a space → accepted
- [ ] Removing `PRINTABLE_ASCII` turns a test red
- [ ] Full gate passes

**Tests**: e2e
**Gate**: full

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

- [ ] `503`, and the captured log does not contain the token
- [ ] `401` for `Token <token>`, and the captured log does not contain the token
- [ ] Adding the token to either log line turns its test red
- [ ] Full gate passes

**Tests**: e2e
**Gate**: full

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

- [ ] Both forms get `200` on `GET /processing-requests`
- [ ] Near-miss: `Bearer` with no token → `401`
- [ ] Dropping the `i` flag of `BEARER` turns a test red
- [ ] Full gate passes

**Tests**: e2e
**Gate**: full

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

- [ ] `npm run lint` passes on the tree
- [ ] Literal negative: in a scratch copy, `console.log(url)` in `start-upload.service.ts` makes `npm run lint` fail naming `no-console`; the same line in `test/` does not
- [ ] Build gate passes

**Tests**: none
**Gate**: build

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
