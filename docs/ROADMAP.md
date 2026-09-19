# FIAP X API roadmap specification

## Outcome

Deliver the authenticated HTTP edge for video submission, owner-scoped status, and authorized ZIP downloads.

## Delivery phases

1. **Bootstrap and quality**: restore dependencies, make the Nest test, lint, and build gates green, and establish CI.
2. **Identity and upload**: validate OIDC JWTs through JWKS, enforce `sub` ownership, validate declared video metadata, and issue short-lived presigned multipart URLs.
3. **Request orchestration**: confirm uploads idempotently and create requests through the Processing Catalog contract.
4. **Read and download**: provide owner-scoped status listing and authorized presigned ZIP download URLs.
5. **Operations**: add structured logs, metrics, traces, containerization, and contract/integration tests.

## Acceptance boundaries

- The API never owns processing-state transitions, media processing, or notification delivery.
- The API never exposes object storage keys or grants cross-owner access.
- RabbitMQ contracts remain versioned and owned through the Catalog workflow.

## Done

WHEN a user completes the public flow THEN the API SHALL authenticate the owner, initiate/confirm the upload safely, expose only that owner's status, and issue an authorized download URL for a completed request.
