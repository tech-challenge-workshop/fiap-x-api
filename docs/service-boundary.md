# FIAP X API service boundary

The API is the only public entry point of FIAP X. This page is its contract with the rest of the system; the mechanics behind each line are in the [README](../README.md).

## Owns

- Bearer JWT validation (OIDC/JWKS) and the owner of every call, which is always the token's `sub`.
- Checking the *declared* file (name, `video/mp4` or `video/quicktime`, 1 to 524288000 bytes) and generating its storage key, `sources/<sub>/<uploadId>.<mp4|mov>`.
- Presigned multipart upload URLs (16 MiB parts) and the short-lived ZIP download URL.
- Confirming an upload: listing and completing the multipart, checking the size, and asking the Catalog to create the request.
- Owner-scoped reads, projected through an allow-list of fields.
- The correlation id of a request (AD-016), and its own logs and metrics (AD-017).

## Does not own

- Processing Request state, its lifecycle, its idempotency record or any event: `processing-catalog`.
- The video bytes (the client sends them straight to storage), their real content (codec, duration) and the ZIP: `processing-worker`.
- Email: `notification-service`.
- Users, tokens, the bucket, its credentials and lifecycle rules: the platform's Keycloak realm and storage bootstrap.
- Any database or queue. The API has no RabbitMQ connection and no tables.

## Interfaces

**Inbound (HTTP, public).** `POST /uploads`, `POST /uploads/:uploadId/complete` (with `Idempotency-Key`), `GET /processing-requests`, `GET /processing-requests/:id` and `GET /processing-requests/:id/download`, all behind a Bearer token; `/health`, `/health/live` and `/metrics` are public. Bodies and status codes: [README, HTTP API](../README.md#http-api).

**Outbound.**

| To | Protocol | Calls |
| --- | --- | --- |
| `processing-catalog` | HTTP (`CATALOG_BASE_URL`) | `POST /processing-requests` with `ownerUserId`, `ownerEmail`, `sourceStorageKey`, `idempotencyKey` and `correlationId` (also sent as `X-Correlation-Id`); `GET /owners/:ownerUserId/processing-requests`, `.../:id` and `.../:id/archive` |
| Object storage | S3 API, path-style (`STORAGE_ENDPOINT`) | create, list parts, complete and abort a multipart upload; find and delete the source; presign part `PUT`s and the ZIP `GET` for `STORAGE_PUBLIC_ENDPOINT` |
| Keycloak | JWKS over HTTP (`OIDC_JWKS_URL`) | fetch the signing keys at first use, and again only for an unknown `kid` |

## Data

The API stores nothing of its own. Storage is the state of an upload in progress (there is no upload table), and the Catalog holds the request. The owner's email is read from the token's `email` claim and passed to the Catalog on confirmation only (AD-015).

## Invariants

- A user reaches only their own requests. Another owner's id, an unknown id and a malformed id get the same `404`.
- No response carries a storage key, and no log line carries a token, an email address, a storage key or a presigned URL.
- One upload is one request: a confirmation replayed with the same key, or with another key for the same upload, answers `200` with the existing request. The Catalog's unique indexes make the creation exactly-once.
- A download URL is issued only for the caller's `COMPLETED` request (`409` otherwise).

## Failure policy

- No valid token: `401`. Signing keys that cannot be fetched: `503`; keys already cached keep working while Keycloak is down.
- Catalog or storage unreachable, or answering something unexpected: `502`. The API does not retry; the client retries the confirmation with the same `Idempotency-Key`. The Catalog call has no timeout of its own yet (V73 in the [roadmap](ROADMAP.md#open-items)).
- Parts that storage refuses: `400`, and the upload is aborted. A size different from the declared one: `400`, and the object is deleted.

## Decisions that bind it

AD-001 (separate service, no shared tables), AD-003 (local DTOs), AD-005 (standard protocols only), AD-008 (no cache tier), AD-014 (any S3 server; RustFS locally), AD-015 (email claim), AD-016 (correlation id born here), AD-017 (logs, redaction, metrics) and AD-018 (multi-arch image on GHCR, run by the kind cluster). The log is [`fiap-x-platform/.specs/STATE.md`](https://github.com/tech-challenge-workshop/fiap-x-platform/blob/main/.specs/STATE.md).
