# API Local Docker Integration Specification

## Problem Statement

API currently creates requests through an in-memory Catalog adapter. It must become the developer entrypoint for a local Docker system, call Catalog over HTTP, and host the Compose/smoke-test assets without owning other services' behavior.

## Goals

- [x] Call Catalog through configurable local HTTP and return its creation result.
- [x] Own the Compose entrypoint, smoke script, API container, and API readiness endpoint.
- [x] Close API verifier findings while preserving local DTOs and no AWS integration.

## Out of Scope

| Feature | Reason |
| --- | --- |
| Catalog lifecycle, AMQP consumers, Worker processing, Notification delivery | Owned by their respective repositories. |
| Root runtime files, shared contracts package, AWS authentication/storage | Outside this local integration slice. |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- |
| Compose home | API repository root owns `compose.yaml` and `scripts/smoke-local-integration.mjs`. | API is the HTTP entrypoint; root is orchestration-only. | y |
| API port | API listens on `3000`; Catalog, Worker, Notification use `3001`–`3003`. | Deterministic smoke-test addresses. | y |

**Open questions:** none.

## User Stories

### P1: Start and submit through the local API ⭐ MVP

**User Story**: As a developer, I want Compose to start from API and POST a request through it so that the system begins with the real HTTP boundary.

**Acceptance Criteria**:

1. WHEN `docker compose up --build --wait` runs from API, THEN the system SHALL build API plus the three sibling services, start RabbitMQ, and wait for all declared health checks. <!-- event-driven -->
2. WHEN a client posts valid `ownerUserId` and `sourceStorageKey`, THEN the API SHALL call Catalog at `CATALOG_BASE_URL` and return `201` with Catalog's `processingRequestId` and `RECEIVED` status. <!-- event-driven -->
3. IF Catalog is unavailable, THEN the API SHALL return numeric HTTP status `502`; IF an unexpected adapter error occurs, THEN the API SHALL return numeric HTTP status `500`. <!-- unwanted-behavior -->
4. WHEN `/health` is called, THEN the API SHALL report ready only when its local process is ready for requests. <!-- event-driven -->
5. WHEN the smoke script runs, THEN it SHALL POST through API and verify the Catalog and Notification observations for the returned request ID. <!-- event-driven -->

**Independent Test**: Compose smoke script posts once to API and observes `COMPLETED` plus one delivery record.

### P2: Preserve API quality findings

**Acceptance Criteria**:

1. WHEN API e2e tests retrieve the Catalog adapter, THEN the test SHALL use a concrete TypeScript value type and pass type-aware checks without TS2749. <!-- event-driven -->
2. The API SHALL retain AppleDouble (`._*`) exclusions from lint/Jest without runtime changes. <!-- ubiquitous -->

## Edge Cases

- IF Compose broker or Catalog health is unavailable, THEN the smoke script SHALL fail rather than report success.
- WHEN Compose restarts, THEN the script SHALL create a new request rather than reuse in-memory state.

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| API-01 | P1 | Design | Verified |
| API-02 | P1 | Design | Verified |
| API-03 | P1 | Design | Verified |
| API-04 | P1 | Design | Verified |
| API-05 | P1 | Design | Verified |
| API-06 | P2 | Design | Verified |
| API-07 | P2 | Design | Verified |

## Success Criteria

- [x] API Compose smoke path proves real HTTP request creation and terminal observations.
- [x] API build, lint, unit, and e2e gates pass without warnings.
