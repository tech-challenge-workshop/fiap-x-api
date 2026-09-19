# FIAP X API service boundary

## Owns

- The HTTP edge for FIAP X.
- HTTP endpoints for upload initiation and confirmation, status lookup, and ZIP download.
- OIDC JWT validation and authorization by the authenticated user's `sub`, using standard claims only.
- Short-lived presigned multipart upload and download URLs for S3-compatible object storage.
- Idempotent upload confirmation through `Idempotency-Key`.

## Primary technology context

NestJS and TypeScript, an OIDC identity provider (Keycloak locally), and S3-compatible object storage (MinIO locally).

## Integrations

- Calls Processing Catalog to create processing requests and query requests filtered by owner.
- Issues presigned storage URLs only after authorization. It never exposes object keys.
- Participates in versioned RabbitMQ contracts through the Processing Catalog workflow; detailed contracts are deferred.

## Does not own

- Processing Request lifecycle transitions or transactional outbox persistence.
- FFprobe/FFmpeg work, frame extraction, ZIP creation, or binary processing.
- Email delivery or notification delivery records.
- Shared database tables with other services.

## Source of truth

This foundation reflects `docs/foudation.md` and the reference documents in the `fiap-x-platform` repository. It is not a product implementation.
