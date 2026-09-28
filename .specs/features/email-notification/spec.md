# Email Notification — API Specification

## Problem Statement

The API validates the caller's JWT and derives `ownerUserId` from `sub`, but never looks at any other claim. S7 needs a real address to send to, and by decision (AD-015: resolve the owner's email from the token's own standard `email` claim, never from Keycloak's Admin API or a second registry) that address has to be captured here, at the one place the raw token is already being verified — then carried to the Catalog when the Processing Request is created.

## Goals

- [ ] Capture the token's standard `email` claim alongside `sub` at verification time, without letting it participate in any authorization decision.
- [ ] Carry it to the Catalog when confirming an upload.

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
| --- | --- |
| Sending email, templates | Owned by `notification-service`. This slice only gets the address to the Catalog. |
| Querying Keycloak's Admin API | AD-015 rejected it: it is a vendor-specific protocol, not a standard one, and a heavier dependency than reading a claim already on the token. |
| Validating the email's format | The identity provider already asserts it; re-validating a claim from an authenticated token is not this service's job. |
| Any change to what a route requires for authorization | `sub`, `iss`, `aud`, `exp` remain the only claims any guard decision reads. |

---

## Assumptions & Open Questions

Every ambiguity is resolved or recorded here - nothing is left silently unclear.

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| `email` is present on the access token, not only the ID token | Assumed present, but must be checked against a real token before this ships | Keycloak's built-in `email` mapper defaults to "add to access token," but this is a runtime config fact, not something safe to assume from the realm file alone | n — verify with `node scripts/get-token.mjs alice` and decode the JWT during implementation |
| Missing `email` claim on an otherwise valid token | Reject the specific operation that needs it (upload confirmation), not authentication globally | A missing optional claim is a precondition failure for one operation, not a reason to fail routes that never needed it (mirrors how `Idempotency-Key` is validated in the service, not the guard) | y |
| Blank/empty-string `email` claim | Treated as absent | Matches the existing pattern for optional string fields elsewhere in this codebase (trim-and-check) | y |
| Where the widened claim is stored on the request | A new `ownerEmail` field, alongside the existing `owner` | Keeps `Owner`'s existing contract (`sub` only) untouched for every caller that doesn't need email | y |

**Open questions:** one, logged above (must confirm the access token carries `email` before implementation proceeds past that point).

---

## User Stories

### P1: Capture the owner's email at authentication ⭐ MVP

**User Story**: As the system, I want the owner's email available right after verifying their token, so that it can be handed to the Catalog without a second lookup anywhere else.

**Why P1**: Every other change in this slice depends on this value existing.

**Acceptance Criteria** (each line is one EARS pattern):

1. WHEN a request carries a valid JWT with a standard `email` claim THEN the guard SHALL make that email available to the handler alongside the owner's `sub`. <!-- event-driven -->
2. The presence or content of the `email` claim SHALL NOT influence any authorization decision. <!-- ubiquitous -->

**Independent Test**: Present a valid token carrying `email`, assert the confirmed upload's downstream Catalog call included it; present one signed the same way but without the claim mapped, assert no authorization outcome changed.

---

### P2: Require it, and carry it to the Catalog

**User Story**: As the request owner, I want my confirmed upload to always be tied to a real address, so that I am not left with a request nobody can notify.

**Why P2**: Depends on P1's capture existing; this is what actually moves the value.

**Acceptance Criteria**:

1. IF an authenticated caller confirms an upload and their token carries no `email` claim THEN the API SHALL reject the confirmation and SHALL NOT create a Processing Request. <!-- unwanted-behavior -->
2. WHEN the API confirms an upload THEN the Processing Request creation call to the Catalog SHALL include the owner's email. <!-- event-driven -->
3. The email address SHALL NOT be written to any log. <!-- ubiquitous -->

**Independent Test**: Confirm an upload with a token lacking `email` → the specific rejection, no request created. Confirm one with `email` present → the Catalog call is asserted (via a test double) to carry it, and the test's log capture contains no occurrence of the address.

---

## Edge Cases

- IF the `email` claim is present but not a string (a malformed or tampered token that otherwise verifies) THEN it SHALL be treated as absent, the same as a blank one.
- WHEN the same upload confirmation is replayed (same owner, same `Idempotency-Key`) THEN the API SHALL make the same Catalog call it made the first time; the Catalog's own idempotency governs what happens to a second, different email value on replay (see the Catalog spec).

---

## Requirement Traceability

`EN-` is shared across this feature: this service owns `EN-01` to `EN-05`, `processing-catalog` owns `EN-06` to `EN-10`, `notification-service` owns `EN-11` to `EN-21`, `fiap-x-platform` owns `EN-22` to `EN-26`.

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| EN-01 | P1: Capture the owner's email | Design | Pending |
| EN-02 | P1: Capture the owner's email | Design | Pending |
| EN-03 | P2: Require and carry it | Design | Pending |
| EN-04 | P2: Require and carry it | Design | Pending |
| EN-05 | P2: Require and carry it | Design | Pending |

**ID format:** `EN-[NUMBER]`

**Coverage:** 5 total, 0 mapped to tasks, 5 unmapped (mapping happens in Tasks).

---

## Success Criteria

- [ ] A token's `email` claim reaches the Catalog's create call, unchanged, without ever entering an authorization branch.
- [ ] A token without the claim fails upload confirmation with a clear reason, and creates nothing.
- [ ] No test or manual run finds the email address in a log line.
