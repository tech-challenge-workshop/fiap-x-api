# API Hardening Specification — api

## Problem Statement

S5 and S6 shipped with open items the Verifiers recorded instead of fixing (the gap analysis's "Validar depois", V21–V33). One is a wrong answer a user can hit today: parts smaller than the part size make the confirmation answer `502` on every retry, as if storage were down, and leave the upload behind (V28). One is a product gap: confirming the same upload with a second `Idempotency-Key` creates a second Processing Request for the same video (V32). The rest are guarantees the spec already makes but no test would defend: the token and presigned URLs never reaching the logs, the bearer scheme being case-insensitive, internal storage calls using the internal endpoint, and two untested branches.

## Goals

- [ ] A client error in the uploaded parts is a `400` that discards the upload, never a `502`
- [ ] One upload yields at most one Processing Request, whatever key confirms it
- [ ] Every "never logged" and routing guarantee from S5 and S6 fails the gate when it regresses

## Out of Scope

| Feature | Reason |
| --- | --- |
| V23 (a key-cache expiry measured by a clock Jest does not fake) | Closed by decision of 2026-09-26: the Verifier judged it implausible |
| Smoke steps proving these fixes on the real stack | Spec C (`platform-gate-hardening`) |
| The Catalog's own validation of the idempotency key (V26, V27) | This feature's Catalog half (`processing-catalog/.specs/features/api-hardening/spec.md`) |
| Resuming or cancelling an upload | Still deferred (S6 `context.md`) |

---

## Assumptions & Open Questions

Decisions of 2026-09-26: V32 = `200` with the same request; V33 = `contentType` case-insensitive; V23 closed.

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Same upload, second key (V32) | `200` with the request the upload already has; nothing is created | Decided: one request per upload | y |
| Is the second key bound to anything | No: it stays unused, so it can later confirm another upload with `201` | Binding it would need a second row per request; the key's job is dedup of retries, which the first key already does | y |
| What counts as "invalid parts" (V28) | Storage refusing the completion because of the parts themselves (`EntityTooSmall`, `InvalidPart`, `InvalidPartOrder`) | Those are caused by what the client uploaded; anything else is still a storage failure (`502`) | y |
| Answer for invalid parts | `400 {"statusCode":400,"message":"Uploaded parts are invalid: every part except the last must be 16777216 bytes"}` and the multipart upload is aborted | Same shape as the other confirmation 400s; aborting frees storage now instead of after the 1-day rule, and a retry then answers `404` like any discarded upload | y |
| `contentType` comparison (V33) | Case-insensitive on the whole value; the object is stored with the lowercase type | Decided; RFC 2045 media types are case-insensitive | y |
| `contentType` with parameters (`video/mp4; codecs=avc1`) | Still `400` | Not requested; the pre-validation compares the bare type | y |
| How "no console output" is enforced (V29) | ESLint `no-console` as an error on `src/`, run by the existing lint gate | A rule stops every `console.*` call at the gate, where a log-capture test only sees the paths it exercises | y |

**Open questions:** none - all resolved or logged above.

---

## User Stories

### P1: Invalid parts are the client's error ⭐ MVP

**User Story**: As a user whose upload went wrong, I want a `400` that says the parts are invalid so that I stop retrying and start a new upload.

**Why P1**: Today the API tells the client storage is down, and every retry repeats it.

**Acceptance Criteria**:

1. IF storage refuses to complete the multipart upload because of its parts THEN the API SHALL respond `400` with the message `Uploaded parts are invalid: every part except the last must be 16777216 bytes`.
2. IF storage refuses the completion because of its parts THEN the API SHALL abort the multipart upload and SHALL NOT create a Processing Request.
3. WHEN the same upload is confirmed again after that `400` THEN the API SHALL respond `404 Upload not found`.
4. IF completing fails for any other reason THEN the API SHALL still respond `502 Storage unavailable`.

**Independent Test**: Against RustFS, declare 20 MiB, upload 1 byte as part 1 and 4 MiB as part 2, confirm: `400`, the in-progress upload is gone, a second confirmation is `404`.

---

### P2: One upload, one request ⭐ MVP

**User Story**: As a user, I want a second confirmation of an upload I already confirmed to return my existing request so that a client that loses its key never processes a video twice.

**Why P2**: The idempotency key protects retries; nothing protected the upload itself.

**Acceptance Criteria**:

1. WHEN an upload already confirmed with one key is confirmed with a different key THEN the API SHALL respond `200` with the existing `processingRequestId` and its status.
2. WHEN that happens THEN no second Processing Request SHALL exist for that upload.
3. WHEN the second key is later used to confirm a different upload THEN the API SHALL respond `201` with a new request.

**Independent Test**: Confirm an upload with K1 (`201`), then with K2 (`200`, same id, the owner's total unchanged), then confirm another upload with K2 (`201`).

---

### P3: `contentType` is case-insensitive

**User Story**: As a client, I want `Video/MP4` accepted like `video/mp4` so that a correct type is not rejected for its casing.

**Why P3**: A standards-correct client can be rejected today.

**Acceptance Criteria**:

1. WHEN `contentType` matches the extension's type ignoring case THEN `POST /uploads` SHALL respond `201`.
2. WHEN such an upload is started THEN the object SHALL be stored with the lowercase content type.
3. IF `contentType` does not match ignoring case THEN the API SHALL still respond `400` naming `contentType`.

**Independent Test**: `POST /uploads` with `.mov` and `VIDEO/QuickTime` → `201`; with `video/mp4` for a `.mov` → `400`.

---

### P4: Secrets never reach the output

**User Story**: As an operator, I want every path that handles a token or a presigned URL proven not to write it anywhere so that logs never carry a credential.

**Why P4**: The code complies today; nothing would catch a regression (V21, V29).

**Acceptance Criteria**:

1. WHEN a request is rejected because the identity provider is unreachable THEN the API SHALL respond `503` and the log output SHALL NOT contain the token.
2. WHEN a request carries an authorization header that is not a bearer token THEN the API SHALL respond `401` and the log output SHALL NOT contain the header's value.
3. The lint gate SHALL fail on any `console` call in `src/`.

**Independent Test**: Call with a valid token while the IdP is down and with `Token <valid token>`; the captured log holds neither token; add a `console.log` to a service and see `npm run lint` fail.

---

### P5: Guarantees the tests did not defend

**User Story**: As a maintainer, I want the remaining S5/S6 behaviours pinned by tests so that a regression turns the gate red.

**Why P5**: They behave correctly today, with no test to defend them (V22, V30, V31).

**Acceptance Criteria**:

1. WHEN the authorization scheme is sent as `bearer` or `BEARER` with a valid token THEN the API SHALL accept the request.
2. WHILE the public storage endpoint is unreachable from the API the API SHALL still start, complete and delete uploads through the internal endpoint.
3. WHEN a part URL is issued THEN it SHALL target the public endpoint.
4. IF the object is deleted between being listed and being read during a confirmation THEN the API SHALL respond `404 Upload not found`.
5. IF the `Idempotency-Key` contains a character outside printable ASCII THEN the API SHALL respond `400` with `Idempotency-Key must be 1 to 255 printable ASCII characters`.

**Independent Test**: Each criterion has one test that goes red when its behaviour is removed.

---

## Edge Cases

- WHEN the second-key confirmation (P2) arrives while the first is still completing THEN exactly one Processing Request SHALL exist afterwards.
- IF aborting the upload after invalid parts fails THEN the API SHALL still respond `400`, and the bucket's 1-day rule SHALL discard the upload.
- WHEN the key is exactly 255 printable characters THEN it SHALL be accepted.

---

## Requirement Traceability

`HARD-` is shared: this service owns `HARD-01` to `HARD-08`, `processing-catalog` `HARD-09` to `HARD-11`.

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| HARD-01 | P1: Invalid parts are the client's error (V28) | Execute | Implementing (T1, T2 done) |
| HARD-02 | P2: One upload, one request (V32) | Execute | Implementing (T6 done) |
| HARD-03 | P3: `contentType` is case-insensitive (V33) | Execute | Implementing (T5 done) |
| HARD-04 | P4: Token never logged on the 503 and non-bearer paths (V21) | Execute | Implementing (T8 done) |
| HARD-05 | P4: No console output (V29) | Tasks | In Tasks |
| HARD-06 | P5: Bearer scheme case-insensitive, tested (V22) | Execute | Implementing (T9 done) |
| HARD-07 | P5: Internal and public storage clients, tested (V30) | Execute | Implementing (T4 done) |
| HARD-08 | P5: `findObject` race and the key's character rule, tested (V31) | Execute | Implementing (T3, T7 done) |

**ID format:** `[CATEGORY]-[NUMBER]`

**Status values:** Pending → In Design → In Tasks → Implementing → Verified

**Coverage:** 8 total, 8 mapped to tasks, 0 unmapped

---

## Success Criteria

- [ ] Undersized parts give `400` and a discarded upload on real RustFS
- [ ] Two keys on one upload give one request
- [ ] Removing any guarantee above turns a test or the lint gate red

---

## Dependencies

`processing-catalog` `HARD-09` (a create with a new key for an already-used source returns the existing request). S5 and S6 are merged.
