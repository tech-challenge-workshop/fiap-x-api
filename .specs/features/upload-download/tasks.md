# Upload and Download Tasks — api

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.** (In this project's sessions the skill is not registered by name; the user has authorized reading it from `.agents/skills/tlc-spec-driven/` by path.)

---

**Design**: `.specs/features/upload-download/design.md`
**Status**: Draft

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec - confirm before Execute. Guidelines found: none - strong defaults applied. Same layers and commands as `auth-owner-scope/tasks.md` (S5). Candidate lessons applied as guidance: L-003/L-004 (test a rejection with an input only that rule rejects), L-005/L-006 (fake every clock before the code reads one; two representatives per class), L-008/L-009 (assert must-not-log on every logging path; pin new spec sentences with a test).

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| Config | unit | Every variable missing/blank named; TTL defaults and bounds | `src/storage/*.spec.ts` | `npm test` |
| Storage port + in-memory double | unit | Every port method, including absence and `'gone'` | `test/support/*.spec.ts` or `src/storage/*.spec.ts` | `npm test` |
| S3 adapter | integration | Round-trip against a real RustFS: create, presigned `PUT` of a real part from outside the SDK, list, complete, replay → `'gone'`, head metadata, presigned GET with disposition, delete; fails instead of skipping in CI without an endpoint | `test/*.e2e-spec.ts` | `npm run test:e2e` |
| Catalog client | unit | Create outcomes 201/200/409 and failures; archive 200/409/404/failure | `src/processing-requests/adapters/*.spec.ts` | `npm test` |
| Services + controllers | e2e | Every route: happy path, every AC and edge case, every error path; no key as a field; no URL or signature in logs | `test/*.e2e-spec.ts` | `npm run test:e2e` |
| Dependencies | none | Build gate only | `package.json` | build gate |

## Gate Check Commands

> Generated from codebase - confirm before Execute. The S3 adapter suite needs RustFS: `docker run -d -p <port>:9000 -e RUSTFS_ACCESS_KEY=fiapx-dev -e RUSTFS_SECRET_KEY=fiapx-dev-secret rustfs/rustfs:1.0.0` and `STORAGE_TEST_ENDPOINT=http://localhost:<port>`.

| Gate Level | When to Use | Command |
| --- | --- | --- |
| Quick | Unit-only tasks | `npm test` |
| Full | Tasks with e2e/integration tests | `npm test && npm run test:e2e` |
| Build | Last task of a phase, dependency tasks | `npm run lint && npm run typecheck && npm test && npm run test:e2e && npm run build` |

---

## Execution Plan

### Phase 1: Storage behind a port

```
T1 -> T2
T1 -> T4
T3 -> T4
T2 -> T5
T4 -> T5
```

### Phase 2: Upload, confirm, download

```
T6 -> T8
T7 -> T8
T6 -> T10
T9
```

---

## Task Breakdown

### Phase 1: Storage behind a port

### T1: Add the S3 SDK and presigner

**What**: `@aws-sdk/client-s3@3.1137.0` and `@aws-sdk/s3-request-presigner@3.1137.0`, pinned exactly (the line `processing-worker` uses).
**Where**: `package.json`
**Depends on**: None
**Reuses**: `processing-worker`'s pin
**Requirement**: UPL-01

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Both pinned exactly; the built app loads them
- [x] Build gate passes

**Tests**: none
**Gate**: build

**Status**: ✅ Complete. `npm install --save-exact` pinned both at `3.1137.0` (no caret); `npm ls` shows one copy of each. Both modules `require()` from `dist/` in Node. Build gate green (unit 82, e2e 54, unchanged).

---

### T2: Load and require the storage configuration

**What**: `loadStorageConfig(env)` with the design's variables; missing/blank required variables throw naming them; TTLs default to 3600/300 and must be positive integers.
**Where**: `src/storage/storage.config.ts`
**Depends on**: T1
**Reuses**: `src/auth/oidc.config.ts`
**Requirement**: UPL-01, UPL-07

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Each required variable missing or blank → error naming it; TTL defaults and invalid values named
- [x] Quick gate passes; at least 8 new tests

**Tests**: unit
**Gate**: quick

**Status**: ✅ Complete. 22 new unit tests in `src/storage/storage.config.spec.ts` (unit 82 → 104). Same shape as `loadOidcConfig`: blank counts as missing, a blank TTL takes its default, `0`, `-1`, `abc` and `1.5` are rejected for each TTL.

---

### T3: Declare the upload storage port and its in-memory double

**What**: `UploadStorage` with the design's methods; an in-memory implementation that models multipart uploads, parts, completion (`'gone'` on a second complete), metadata, prefixes, deletion and presigned URLs as inspectable fakes.
**Where**: `src/storage/upload-storage.port.ts`
**Depends on**: None
**Reuses**: Nothing
**Requirement**: UPL-01, UPL-03

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Double's behaviour matches the spike table row by row (listed in the tests)
- [x] Quick gate passes; at least 8 new tests

**Tests**: unit
**Gate**: quick

**Status**: ✅ Complete. 14 new unit tests in `src/storage/in-memory-upload-storage.spec.ts` (unit 104 → 118). Two deviations from design.md:
- The double lives at `src/storage/in-memory-upload-storage.ts`, not `test/support/`. The unit Jest config has `rootDir: src`, so its spec would never run from `test/support`; `InMemoryCatalogClient` sits in `src/` for the same reason.
- `listParts` returns `UploadedPart[] | 'gone'`. A concurrent confirmation can complete the upload between `findInProgress` and `listParts`. Without `'gone'` the loser would answer 502 instead of carrying the request id (P2 AC 9).

---

### T4: Implement the port against S3 with the checksum fix

**What**: `S3UploadStorage` with an internal client and a public presigning client, both `requestChecksumCalculation`/`responseChecksumValidation: 'WHEN_REQUIRED'`, `forcePathStyle`, fixed signing region; `NoSuchUpload` → `'gone'`; absence as a return value; other errors → `StorageUnavailableError`.
**Where**: `src/storage/s3-upload-storage.ts`
**Depends on**: T1, T3
**Reuses**: `processing-worker/src/storage/s3-object-storage.ts` client options
**Requirement**: UPL-01, UPL-03, UPL-07

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Integration suite against real RustFS covers every spike row, including a presigned part `PUT` sent with plain `fetch` (not the SDK) returning 200
- [x] **Verified negatively**: with the checksum setting removed in a scratch copy, the presigned `PUT` test fails with `BadDigest`
- [x] In CI (`CI` set) without `STORAGE_TEST_ENDPOINT` the suite fails rather than skips; CI starts `rustfs/rustfs:1.0.0` (workflow change listed as a deviation)
- [x] Full gate passes

**Tests**: integration
**Gate**: full

**Status**: ✅ Complete. `test/s3-upload-storage.e2e-spec.ts` adds 14 tests (e2e 54 → 68, 0 skipped with `STORAGE_TEST_ENDPOINT` set): 8 against RustFS 1.0.0 and 6 unreachable-storage cases that need no server.
- The suite signs for `STORAGE_TEST_ENDPOINT` as the public endpoint and makes its own calls through the other loopback name. A working URL therefore proves the public client signed it, and the same URL on the internal host gets 403.
- Negative check: with both `WHEN_REQUIRED` lines removed from a scratch copy, 5 tests failed with `400 <Code>BadDigest</Code>`. The file was then restored.
- With `CI=true` and no endpoint the suite reports 1 failed; without `CI` its 8 real-endpoint tests skip.
- **Deviation (workflow):** `.github/workflows/ci.yml` starts `rustfs/rustfs:1.0.0` before `npm run test:e2e` and sets `STORAGE_TEST_ENDPOINT=http://localhost:9000` on that step, as `processing-worker` does.
- `StorageUnavailableError` is in `src/storage/storage-unavailable.error.ts`.

---

### T5: Bind the storage adapter and fail closed

**What**: `StorageModule` binding `UPLOAD_STORAGE` to `S3UploadStorage` from `loadStorageConfig`; the app refuses to boot without the variables; e2e suites override the provider with the in-memory double and set the variables.
**Where**: `src/storage/storage.module.ts`
**Depends on**: T2, T4
**Reuses**: `AuthModule`'s fail-closed pattern
**Requirement**: UPL-01

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Composition e2e: boot fails naming each missing variable; with them set the bound adapter is `S3UploadStorage`
- [x] Existing e2e suites updated to set storage variables and override the provider (listed; no assertion weakened)
- [x] Build gate passes

**Tests**: e2e
**Gate**: build

**Status**: ✅ Complete. `test/storage-composition.e2e-spec.ts` adds 6 tests (e2e 68 → 74, 0 skipped). `StorageModule` exports `STORAGE_CONFIG` and `UPLOAD_STORAGE`; `AppModule` imports it. The new helper `test/support/test-storage.ts` (`TestStorageEnv`) sets and restores the storage variables.

Existing suites changed, setup only, no assertion touched:
- `app`, `auth`, `auth-outage`, `get-processing-request`, `list-processing-requests`, `processing-requests`: set the storage variables and override `UPLOAD_STORAGE` with `InMemoryUploadStorage`.
- `auth-composition`: sets the storage variables only. It boots through `NestFactory` and cannot override; building the S3 clients opens no connection.

---

### Phase 2: Upload, confirm, download

### T6: Extend the Catalog client for idempotent create and the archive key

**What**: `createProcessingRequest(owner, key, idempotencyKey)` → `CatalogCreateOutcome` (201/200/409); `getArchive(owner, id)` → `{ zipStorageKey } | 'not-completed' | undefined`; HTTP and in-memory adapters.
**Where**: `src/processing-requests/ports/catalog-client.port.ts`
**Depends on**: None
**Reuses**: `HttpCatalogClient` shape
**Requirement**: UPL-03, UPL-04, UPL-07

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [x] HTTP adapter (local server): each status mapped; network failure and malformed body → `CatalogUnavailableError`; owner and id URL-encoded
- [x] In-memory: same key + same source → replayed; other source → conflict; archive per status
- [x] Quick gate passes; at least 10 new tests

**Tests**: unit
**Gate**: quick

**Status**: ✅ Complete. 29 new unit tests (unit 118 → 147).
- HTTP create: 201 → `created`, 200 → `replayed` (both keep only id and status), 409 → `conflict`. A 400, a 500, a 202, a non-JSON body, a body without id, or no connection → `CatalogUnavailableError`. The body now carries `idempotencyKey`.
- HTTP archive: 200 `{zipStorageKey}`, 409 → `'not-completed'`, 404 → `undefined`, the owner and id encoded in `/owners/:owner/processing-requests/:id/archive`. Anything else, or an empty or non-string key → `CatalogUnavailableError`.
- In-memory: idempotent per `(owner, key)`; `setStatus(id, status, zipStorageKey?)` stands in for the Worker in tests. `getArchive` returns the key only for `COMPLETED`.
- Existing tests changed for the new signature, no assertion weakened: the fetch-spy create tests pass a key and expect it in the body; their mocked responses now carry a status. The malformed-body test now answers 201, so only the shape check can reject it. The in-memory tests pass a key per call.
- **Transitional deviation:** `CreateProcessingRequestService` (removed in T9) passes a fresh `randomUUID()` key so it compiles against the new port. Its unit test and the matching `processing-requests` e2e assertion now expect a third `expect.any(String)` argument. Both go away in T9.

---

### T7: Start an upload

**What**: `StartUploadDto`, `StartUploadService`, `POST /uploads` in `UploadsController`.
**Where**: `src/uploads/start-upload.service.ts`
**Depends on**: None
**Reuses**: `@Owner()`, the storage port
**Requirement**: UPL-01, UPL-02, UPL-10

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [x] e2e: 201 with `partSize` 16 777 216, part numbers 1..ceil(size/partSize) for sizes 1, exactly 2×partSize, and 2×partSize+1; `expiresAt` one hour ahead (fake clock); key under `sources/<sub>/` with the lowercase extension (asserted on the double); no key field in the body
- [x] 400 naming the field for: `.avi`, no extension, `.MP4` with `video/quicktime`, `.mov` with `video/mp4`, size 0, 524 288 001, non-integer
- [x] 401 without a token and storage untouched; storage failure → 502
- [x] No URL or `X-Amz-Signature` in captured logs
- [x] Full gate passes

**Tests**: e2e
**Gate**: full

**Status**: ✅ Complete. `test/start-upload.e2e-spec.ts` adds 22 tests (e2e 74 → 96, 0 skipped; unit 147 unchanged).
- `src/uploads/`: `StartUploadDto`, `StartUploadService`, `UploadsController`, `UploadsModule` (imported by `AppModule`).
- Each field has one constraint, so a bad field yields exactly one message. An invalid `fileName` names only `fileName`: `contentType` then accepts either video type.
- `CatalogErrorFilter` now also catches `StorageUnavailableError` → `502 {statusCode:502, message:'Storage unavailable'}`. The storage error's own text is not echoed.
- The clock test freezes only `Date`, at the real current time, so tokens stay valid; `expiresAt` must equal it + 3600 s exactly.
- The log test proves the capture works (Nest's route line is present) before asserting that no URL and no signature appear, on a success and on a storage failure.
- Beyond the listed cases: 256 characters rejected and 255 accepted (design DTO bound); the 500 MiB maximum gives 32 parts; a `sizeBytes` string and a non-video `contentType` are rejected.
- **Spec-precision gap:** the spec does not say whether `contentType` matches case-sensitively. The API accepts only the exact lowercase types.

---

### T8: Confirm an upload exactly once

**What**: `CompleteUploadService` (design algorithm) and `POST /uploads/:uploadId/complete` reading the `Idempotency-Key` header.
**Where**: `src/uploads/complete-upload.service.ts`
**Depends on**: T6, T7
**Reuses**: Storage port, Catalog client, constant 404
**Requirement**: UPL-03, UPL-04, UPL-05, UPL-06, UPL-10

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [x] e2e: 201 then 200 with the same id for a replay; the Catalog receives the owner's `sub`, the generated key and the client's key
- [x] 409 for the key on a second upload; 400 for missing/blank/over-long key; 400 when no part was uploaded; 400 naming the size when the real size differs, with the object deleted and no Catalog call
- [x] 404 for another user's `uploadId`, a random UUID, a malformed id, and an upload discarded before confirmation
- [x] Two concurrent confirmations → one Catalog request id in both responses
- [x] Storage or Catalog failure → 502; a retry after a Catalog failure still yields one request
- [x] Full gate passes

**Tests**: e2e
**Gate**: full

**Status**: ✅ Complete. `test/complete-upload.e2e-spec.ts` adds 21 tests (e2e 96 → 117, 0 skipped; unit 147 unchanged).
- `CompleteUploadService` follows the design algorithm. The `Idempotency-Key` is checked first, before storage is touched: missing, empty or blank → 400 "Idempotency-Key header is required"; over 255 characters or not printable ASCII → 400. A non-UUID `uploadId` → 404 before storage is touched. A `listParts` of `'gone'` falls through exactly like a `complete` of `'gone'`.
- Concurrency is tested deterministically, both ways a loser can meet the winner. A barrier holds both confirmations inside `complete`, so the outcomes are `completed` and `gone`, and the responses are 201 and 200 with one id. In the other test, the second confirmation runs to the end inside the first one's `listParts`.
- Retry after failure: the Catalog down, and storage failing once in `listParts`, `complete` and `findObject`. Each gives 502, then 201 on retry, with exactly one request.
- Scratch mutants were run and then restored. Four were killed: treating `listParts` `'gone'` as 404, treating `complete` `'gone'` as 404, not deleting the mismatched object, and dropping the UUID check. The UUID-check mutant was the one that survived at first, which is why a test now pins that a malformed id never reaches storage.
- **Interpretation:** the 404 body is `{statusCode:404, message:'Upload not found'}`, the same for all four causes. I read design's "constant 404" as that rule rather than S5's request-specific text.
- `ProcessingRequestsModule` exports `CATALOG_CLIENT`; `UploadsModule` imports it. `test/support/upload-flow.ts` starts, uploads and confirms through the API for later suites.

---

### T9: Remove the key-supplied create route

**What**: Delete `POST /processing-requests`, `CreateProcessingRequestService`, its DTOs and its tests; rewrite any suite that created requests through it to use the upload flow.
**Where**: `src/processing-requests/controllers/processing-requests.controller.ts`
**Depends on**: None
**Reuses**: The upload flow from T7/T8 for rewritten suites
**Requirement**: UPL-09

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [x] e2e: `POST /processing-requests` with a valid token → 404
- [x] No route accepts a storage key (a test asserts the route table)
- [x] Each deleted or rewritten test listed with its reason; test counts may fall only by the deleted route's own tests
- [x] Full gate passes

**Tests**: e2e
**Gate**: full

**Status**: ✅ Complete. Unit 147 → 138; e2e 117 → 115; 0 skipped. The drops are exactly the removed route's own tests.
- Deleted with the route: `CreateProcessingRequestService` + its spec (3 unit tests), `CreateProcessingRequestDto` + its spec (6 unit tests), `CreateProcessingRequestResponseDto`.
- `CATALOG_CLIENT` moved to `ports/catalog-client.port.ts`; every import follows it.
- `test/processing-requests.e2e-spec.ts`: its 6 tests exercised only the removed route (201, missing owner, owner from the token, two 400s, 502). They are replaced by 4 tests:
  - `POST /processing-requests` with a valid token → 404, nothing reaches the Catalog.
  - The exact route table: `GET /`, `GET /health`, `GET /processing-requests`, `GET /processing-requests/:id`, `POST /uploads`, `POST /uploads/:uploadId/complete`.
  - `POST /uploads` with `sourceStorageKey` → 400 "property sourceStorageKey should not exist", storage untouched.
  - A `sourceStorageKey` sent to the confirmation is ignored: the Catalog gets the generated key.
- Rewritten, no assertion weakened:
  - `get-processing-request` and `list-processing-requests` now create through `createThroughUpload` (start, parts, confirm). Their "never shows the key" checks now use the generated key instead of a made-up one.
  - `auth` used the removed route only as a protected route that reaches the Catalog. It now calls `GET /processing-requests`: the success case expects 200 instead of 201, and still exactly one Catalog call. The 401, 503 and log assertions are unchanged.
- The T6 transitional deviation is gone with the service.

---

### T10: Issue a download URL to the owner of a completed request

**What**: `DownloadService` and `GET /processing-requests/:id/download`.
**Where**: `src/processing-requests/services/download.service.ts`
**Depends on**: T6
**Reuses**: Constant 404, storage port `presignGet`
**Requirement**: UPL-07, UPL-08, UPL-10

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] e2e: `COMPLETED` → `200 {url, expiresAt}` with `expiresAt` five minutes ahead (fake clock) and the presign called with the archive key and `frames-<id>.zip`; a second call issues a new URL
- [ ] 409 for `QUEUED`/`PROCESSING`/`FAILED`; 404 byte-identical for another owner, random UUID, malformed id; 502 on Catalog or storage failure
- [ ] No `zipStorageKey` field; no URL in logs
- [ ] Build gate passes

**Tests**: e2e
**Gate**: build

---

## Phase Execution Map

```
Phase 1 (T1 T2 T3 T4 T5) then Phase 2 (T6 T7 T8 T9 T10)
```

10 tasks pack into two batches: **Phase 1** (5) and **Phase 2** (5). Cross-repository order: `processing-catalog` first, then this repository, then `fiap-x-platform`.

---

## Task Granularity Check

| Task | Scope | Status |
| --- | --- | --- |
| T1: SDK dependencies | 2 pins | ✅ Granular |
| T2: Storage config | 1 function | ✅ Granular |
| T3: Port + in-memory double | 1 port, its double | ⚠️ OK - cohesive |
| T4: S3 adapter | 1 class (+ CI service) | ✅ Granular |
| T5: Storage module | 1 module + composition | ✅ Granular |
| T6: Catalog client additions | 1 port + 2 adapters | ⚠️ OK - cohesive |
| T7: Start upload | 1 route + service + DTO | ⚠️ OK - one endpoint |
| T8: Confirm upload | 1 route + service | ✅ Granular |
| T9: Remove old route | 1 deletion | ✅ Granular |
| T10: Download | 1 route + service | ✅ Granular |

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows (within phase) | Status |
| --- | --- | --- | --- |
| T1 | None | — | ✅ Match |
| T2 | T1 | T1 → T2 | ✅ Match |
| T3 | None | — | ✅ Match |
| T4 | T1, T3 | T1 → T4, T3 → T4 | ✅ Match |
| T5 | T2, T4 | T2 → T5, T4 → T5 | ✅ Match |
| T6 | None | — | ✅ Match |
| T7 | None | — | ✅ Match |
| T8 | T6, T7 | T6 → T8, T7 → T8 | ✅ Match |
| T9 | None | — | ✅ Match |
| T10 | T6 | T6 → T10 | ✅ Match |

No task depends on a later phase.

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| --- | --- | --- | --- | --- |
| T1 | Dependencies | none | none | ✅ OK |
| T2 | Config | unit | unit | ✅ OK |
| T3 | Storage port + in-memory double | unit | unit | ✅ OK |
| T4 | S3 adapter | integration | integration | ✅ OK |
| T5 | Services + controllers (wiring) | e2e | e2e | ✅ OK |
| T6 | Catalog client | unit | unit | ✅ OK |
| T7 | Services + controllers | e2e | e2e | ✅ OK |
| T8 | Services + controllers | e2e | e2e | ✅ OK |
| T9 | Services + controllers | e2e | e2e | ✅ OK |
| T10 | Services + controllers | e2e | e2e | ✅ OK |
