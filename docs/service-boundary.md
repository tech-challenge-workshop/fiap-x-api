# FIAP X API service boundary

## Owns

- The HTTP edge for FIAP X.
- HTTP endpoints for upload initiation and confirmation, status lookup, and ZIP download.
- Cognito JWT validation and authorization by the authenticated user's `sub`.
- Short-lived S3 presigned multipart upload and download URLs.
- Idempotent upload confirmation through `Idempotency-Key`.

## Primary technology context

NestJS and TypeScript, Amazon Cognito, and Amazon S3.

## Integrations

- Calls Processing Catalog to create processing requests and query requests filtered by owner.
- Issues S3 URLs only after authorization. It never exposes S3 object keys.
- Participates in versioned RabbitMQ contracts through the Processing Catalog workflow; detailed contracts are deferred.

## Does not own

- Processing Request lifecycle transitions or transactional outbox persistence.
- FFprobe/FFmpeg work, frame extraction, ZIP creation, or binary processing.
- Email delivery or notification delivery records.
- Shared database tables with other services.

## Source of truth

This foundation reflects `docs/foudation.md`, `docs/FIAP X.pdf`, and `docs/POSTECH - SOAT - Fase 5 - Hacka.pdf` in the parent workspace. It is not a product implementation.
