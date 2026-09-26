# Auth and Owner Scope Specification — api

## Problem Statement

The API accepts anyone. `POST /processing-requests` takes `ownerUserId` from the request body (`src/processing-requests/dtos/create-processing-request.dto.ts:5`), so any caller can create work in anyone's name, and there is no way for a user to see their own requests at all: the only read is the Catalog's `GET /processing-requests/:id`, reachable only in local integration mode. The hackathon requires the system to be protected by username and password (RF-3) and to list a user's video statuses (RF-4); neither holds today.

This slice puts the API behind JWT validation against a local OIDC provider, takes the owner from the token's `sub`, and adds the two owner-scoped reads the product is missing.

## Goals

- [ ] No user-facing endpoint does anything for an unauthenticated caller, and the Catalog is never called on their behalf
- [ ] The owner of every created request is the authenticated user, whatever the request body says
- [ ] An authenticated user can list their own requests and read one by id, and can never observe another user's

## Out of Scope

| Feature | Reason |
| --- | --- |
| Running the identity provider, its realm and demo users | `fiap-x-platform` owns the topology (AUTH-14 to AUTH-17) |
| The owner-filtered queries themselves | `processing-catalog` (AUTH-10 to AUTH-13); this service validates, scopes and projects |
| Constraining `sourceStorageKey` to the caller's objects | S6 generates source keys under the owner in the upload flow; until then the key is free-form (see Assumptions) |
| Upload, presigned URLs, download, `Idempotency-Key` | S6 |
| Application roles, self-registration, account management | `docs/foudation.md`: no roles beyond the operational administrator; provisioning is administrative |
| Filtering the list by status | Not requested; a separate capability |
| Browser login flows | No front end in scope |

---

## Assumptions & Open Questions

Decisions from the gray-area discussion of 2026-09-26 are in `fiap-x-platform/.specs/features/auth-owner-scope/context.md`.

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Which claims are read | `sub`, `iss`, `aud`, `exp` only | `docs/foudation.md`: a proprietary claim couples the domain to one vendor and turns configuration into code | y |
| Pagination | `page` + `pageSize`, default 20, max 100, newest first; response `items`, `page`, `pageSize`, `total` | Discussed: simple to demo and test; per-user volume is small, so offset costs nothing real | y |
| Fields a user sees | `processingRequestId`, `status`, `createdAt`, `updatedAt`, and `failureReason` only when `FAILED` | Discussed: the safe sentence is the user contract; the code is internal vocabulary. Storage keys are never exposed (`docs/foudation.md`) | y |
| Another user's request | `404`, identical to a request that does not exist | Discussed (and the gap analysis S5 seed): a `403` would confirm the id exists | y |
| Identity provider unreachable, no cached key | `503` | Discussed: the fault is ours; a `401` would send clients into a re-login loop | y |
| Invalid pagination | `400` naming the parameter and its range | Discussed: the response must match the request; clamping hides the error | y |
| `ownerUserId` in a create body | Ignored | Discussed: cannot be used to impersonate anyone, and does not break older clients | y |
| `sourceStorageKey` free-form until S6 | Known risk, not addressed here | Discussed: an authenticated user can name another user's source object. S6 closes it by generating keys under the owner | y |
| Catalog unreachable on the new reads | `502`, as creation already does (`CatalogErrorFilter`) | One contract for "the Catalog failed" across the API | y |
| A malformed id in `GET /processing-requests/:id` | `404` | Any other status would be an oracle telling a caller which ids are well-formed | y |
| Health endpoint | Stays unauthenticated | Readiness and liveness probes carry no user identity | y |
| Token lifetime | The provider's default (Keycloak: 5 minutes) | Nothing in the product asks for a different value | y |

**Open questions:** none - all resolved or logged above.

---

## User Stories

### P1: Only authenticated calls reach the system ⭐ MVP

**User Story**: As the product owner, I want every user-facing call authenticated so that the system is protected by username and password.

**Why P1**: It is RF-3, and every other story in this slice depends on knowing who the caller is.

**Acceptance Criteria**:

1. IF a request to a `/processing-requests` endpoint carries no `Authorization: Bearer` token THEN the API SHALL respond `401` and SHALL NOT call the Catalog.
2. IF the token's signature does not verify against the provider's published keys THEN the API SHALL respond `401` and SHALL NOT call the Catalog.
3. IF the token is expired THEN the API SHALL respond `401` and SHALL NOT call the Catalog.
4. IF the token's `iss` is not the configured issuer THEN the API SHALL respond `401` and SHALL NOT call the Catalog.
5. IF the token's `aud` does not include the configured audience THEN the API SHALL respond `401` and SHALL NOT call the Catalog.
6. IF the token has no `sub` THEN the API SHALL respond `401` and SHALL NOT call the Catalog.
7. IF the provider's keys cannot be fetched and no cached key matches the token THEN the API SHALL respond `503` and SHALL NOT call the Catalog.
8. WHILE the provider is unreachable the API SHALL keep accepting tokens signed by a key it has already cached.
9. The API SHALL read no claim other than `sub`, `iss`, `aud` and `exp` to authorize a request.
10. The API SHALL serve `/health` without a token.

**Independent Test**: Call `GET /processing-requests` with no token, a tampered token, an expired token and a token for another audience, and see `401` each time with the Catalog client never invoked; call it with a valid token and see `200`.

---

### P2: Requests are owned by the authenticated user ⭐ MVP

**User Story**: As a user, I want the requests I create to be mine so that nobody can create work in my name or claim mine.

**Why P2**: Taking the owner from the body is the hole this slice exists to close.

**Acceptance Criteria**:

1. WHEN an authenticated user creates a processing request THEN the API SHALL pass the token's `sub` to the Catalog as `ownerUserId`.
2. IF the create body contains an `ownerUserId` THEN the API SHALL ignore it and SHALL still use the token's `sub`.
3. WHEN a request is created THEN the API SHALL respond `201` with `processingRequestId` and `status` and SHALL NOT include `sourceStorageKey`.

**Independent Test**: Create a request as `alice` with `ownerUserId: "bob"` in the body; the Catalog records `alice`'s `sub` as the owner.

---

### P3: A user lists their own requests ⭐ MVP

**User Story**: As a user, I want to list my processing requests and their statuses so that I can follow my videos.

**Why P3**: It is RF-4, and it has no implementation today.

**Acceptance Criteria**:

1. WHEN an authenticated user calls `GET /processing-requests` THEN the API SHALL return only requests whose owner is the token's `sub`.
2. WHEN the list is returned THEN it SHALL be ordered by `createdAt`, newest first.
3. WHEN no `page` or `pageSize` is given THEN the API SHALL use `page=1` and `pageSize=20`.
4. WHEN the list is returned THEN the body SHALL be `{ items, page, pageSize, total }`, where `total` is the number of the caller's requests.
5. WHEN a request is listed THEN its item SHALL contain `processingRequestId`, `status`, `createdAt` and `updatedAt`, and SHALL contain `failureReason` if and only if `status` is `FAILED`.
6. The API SHALL NOT include `sourceStorageKey`, `zipStorageKey`, `failureCode`, `attemptId` or `ownerUserId` in any response.
7. IF `page` is not an integer ≥ 1 THEN the API SHALL respond `400` naming `page` and its allowed range, and SHALL NOT call the Catalog.
8. IF `pageSize` is not an integer between 1 and 100 THEN the API SHALL respond `400` naming `pageSize` and its allowed range, and SHALL NOT call the Catalog.
9. WHEN the page is beyond the last one THEN the API SHALL return `items: []` with the true `total`.
10. IF the Catalog is unreachable or answers with an error THEN the API SHALL respond `502`.

**Independent Test**: With requests created as `alice` and as `bob`, `alice`'s list contains only hers, newest first, with `total` equal to her count; `bob`'s is disjoint.

---

### P4: A user reads one of their requests

**User Story**: As a user, I want to read one of my requests by id so that I can check a single video.

**Why P4**: The list covers RF-4; reading one is the natural companion and the place where cross-user access must be proved impossible.

**Acceptance Criteria**:

1. WHEN the owner calls `GET /processing-requests/:id` THEN the API SHALL respond `200` with the item shape of P3 AC5.
2. IF the request exists but belongs to another user THEN the API SHALL respond `404` with the same body as for a request that does not exist.
3. IF no request has that id, or the id is malformed THEN the API SHALL respond `404`.
4. IF the Catalog is unreachable or answers with an unexpected error THEN the API SHALL respond `502`.

**Independent Test**: `alice` reads her request (`200`); `bob` reads the same id and gets exactly the `404` body a random id gets.

---

## Edge Cases

- WHEN a user has no requests THEN the list SHALL be `items: []` with `total: 0` and `200`.
- IF the `Authorization` header uses a scheme other than `Bearer` THEN the API SHALL respond `401`.
- IF the token has no `exp` claim THEN the API SHALL respond `401`. (Added during Execute: T4 found such a token accepted — it would never expire. Keycloak always sets `exp`; the guard must not depend on that.)
- IF a token is valid but its signing key was rotated out of the provider's key set THEN the API SHALL refetch the key set once and SHALL respond `401` if the key is still absent.
- The API SHALL NOT log the token or any part of its signature.

---

## Requirement Traceability

`AUTH-` is shared across the three repositories of this slice: this service owns `AUTH-01` to `AUTH-09`, `processing-catalog` owns `AUTH-10` to `AUTH-13`, `fiap-x-platform` owns `AUTH-14` to `AUTH-17`.

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| AUTH-01 | P1: Only authenticated calls reach the system | Execute | Implementing |
| AUTH-02 | P1: Only authenticated calls reach the system | Execute | Implementing |
| AUTH-03 | P1: Only authenticated calls reach the system | Execute | Implementing |
| AUTH-04 | P2: Requests are owned by the authenticated user | Tasks | In Tasks |
| AUTH-05 | P3: A user lists their own requests | Tasks | In Tasks |
| AUTH-06 | P3: A user lists their own requests | Tasks | In Tasks |
| AUTH-07 | P3: A user lists their own requests | Tasks | In Tasks |
| AUTH-08 | P4: A user reads one of their requests | Tasks | In Tasks |
| AUTH-09 | P1–P4: responses never expose storage keys or internal codes | Tasks | In Tasks |

**ID format:** `[CATEGORY]-[NUMBER]`

**Status values:** Pending → In Design → In Tasks → Implementing → Verified

**Coverage:** 9 total, 9 mapped to tasks, 0 unmapped

---

## Success Criteria

- [ ] Every `/processing-requests` call without a valid token gets `401` and the Catalog client is never invoked
- [ ] `alice` and `bob` see disjoint lists; each gets `404` on the other's ids
- [ ] A request created with `ownerUserId: "someone-else"` in the body is owned by the caller
- [ ] No response body contains a storage key, a failure code or an owner id
- [ ] With the provider stopped, a token signed by a cached key still works and a token needing an uncached key gets `503`

---

## Dependencies

`processing-catalog` AUTH-10 to AUTH-13 (owner-filtered list and read) and `fiap-x-platform` AUTH-14 to AUTH-17 (the identity provider, its realm and demo users, the token helper and the authenticated smoke). The API can be built and tested against a local key set before those exist; the end-to-end proof needs them.
