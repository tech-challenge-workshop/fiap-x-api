# FIAP X API

The FIAP X API is the HTTP edge for the video-processing platform. It authenticates users, enforces request ownership, issues presigned S3 URLs, confirms uploads idempotently, and exposes processing status and authorized ZIP downloads.

See [the service boundary](docs/service-boundary.md) for ownership, integrations, and explicit exclusions.

## Foundation scope

This repository intentionally contains no NestJS scaffold or infrastructure configuration yet. The approved system architecture is in the `fiap-x-platform` repository's `docs/foudation.md`.
