# API Initial Vertical Slice Specification

## Problem Statement

The API must start the FIAP X flow without taking ownership of processing state. This first slice proves the API-to-Catalog boundary with a controlled request, before Cognito, S3 upload, and presigned URLs are implemented.

## Goals

- [ ] Define owner-scoped creation input and Catalog delegation.
- [ ] Keep all Processing Request transitions inside Processing Catalog.

## Out of Scope

| Feature | Reason |
| --- | --- |
| Cognito JWT validation | Added in the upload slice. |
| S3 presigned URLs and multipart upload | Added in the upload slice. |
| Direct RabbitMQ publication | Catalog owns lifecycle event publication. |

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Identity input | A controlled `ownerUserId` is supplied by the first API boundary. | It lets the integration path be tested before Cognito. | Yes |
| Catalog transport | The API calls a controlled Catalog boundary. | The transport detail is deferred; lifecycle ownership is not. | Yes |

**Open questions:** none - all resolved or logged above.

## User Stories

### P1: Delegate request creation

**User Story**: As a developer, I want the API to submit an owner-scoped creation command to the Catalog so that the Catalog owns the new Processing Request.

**Why P1**: It is the first entry point of the vertical slice.

**Acceptance Criteria**:

1. WHEN the API receives a controlled request with `ownerUserId` and `sourceStorageKey` THEN it SHALL delegate one creation command to the Catalog.
2. WHEN the Catalog accepts creation THEN the API SHALL return the resulting `processingRequestId` without assigning a processing status.
3. IF `ownerUserId` or `sourceStorageKey` is absent THEN the API SHALL reject the request before calling the Catalog.
4. IF the Catalog rejects creation THEN the API SHALL return a failure outcome and SHALL not publish a processing event.

**Independent Test**: Submit valid and invalid controlled requests against the API boundary with a Catalog test double.

## Edge Cases

- IF the API receives duplicate creation input THEN it SHALL leave duplicate-handling policy to the Catalog in this slice.

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| API-01 | P1: Delegate request creation | Tasks | Done |
| API-02 | P1: Delegate request creation | Tasks | Done |
| API-03 | P1: Delegate request creation | Tasks | Done |
| API-04 | P1: Delegate request creation | Tasks | Pending |

**Coverage:** 4 total, 4 mapped to future tasks, 0 unmapped.

## Success Criteria

- [ ] A valid controlled request reaches the Catalog with its owner and source key.
- [ ] The API contains no Processing Request transition logic.
