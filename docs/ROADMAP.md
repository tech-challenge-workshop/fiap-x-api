# FIAP X API roadmap

What has been delivered in this repository, slice by slice, and what is still open. The slices are cross-repository; the platform's [README](https://github.com/tech-challenge-workshop/fiap-x-platform) describes the whole system, and each slice's spec is under [`.specs/features/`](../.specs/features/).

## Delivered

Dates are merge dates on `main`.

| Slice | What it gave the API | Merged |
| --- | --- | --- |
| Foundation | Repository, NestJS app, a first create route over an in-memory Catalog, then the HTTP Catalog client and a `/health` route for a local Docker run | 2026-08-25 to 08-28, direct commits |
| Local-first stack | Service boundary moved off the managed cloud (AD-005) | #1, 2026-09-19 |
| S1 · CI | `quality` job: lint, typecheck, unit and e2e tests, build; hardened gates | #2, 2026-09-20; #4, 2026-09-21 |
| S2 to S4 | Nothing here: lifecycle, persistence and media work live in the Catalog and the Worker | - |
| S5 · Auth and owner scope | Global JWT guard over OIDC/JWKS, `sub` as owner, owner-scoped list and get (AUTH-01..09) | #5, 2026-09-26 |
| S6 · Upload and download | Presigned multipart upload, idempotent confirmation, download URL; the key-supplied create route removed (UPL-01..10) | #6, 2026-09-26 |
| Spec B · API hardening | `400` on invalid parts, one request per upload, case-insensitive `contentType`, log and lint guards (HARD-01..08) | #7, 2026-09-26 |
| S7 · Email | The token's `email` claim passed to the Catalog on confirmation (RF-5, AD-015) | #8, 2026-09-28 |
| S8 · Observability | Correlation id at the edge, JSON logs with redaction, `/metrics` (AD-016, AD-017) | #9, 2026-09-29 |
| S9a · Kubernetes | Multi-arch image published to GHCR on every merge to `main`, run by the kind cluster (AD-018) | #10, 2026-09-29 |

## Open items

From the verification record kept alongside the project ("Validar depois"). None blocks the delivered flow.

- **V40** (tests): about 7% of full e2e runs fail intermittently on macOS because supertest binds the wildcard address and dials `127.0.0.1`. The S8 suites use `test/support/listen.ts`; the twelve older suites still need it. Spec G (`fix/api-test-hardening`) is written, not implemented.
- **V41**: the `no-console` rule has no guard of its own, and `globalThis.console.log` or `process.stdout.write` pass the lint; the `\x7E` bound of the printable-ASCII check is not pinned. Also spec G.
- **V63**: a request that matches no controller is counted with `route="{/*splat}"` instead of `unmatched`; the Worker's mapping is not ported here.
- **V64**: audit two leaks the other services' verifiers found: `useLogger` in `main.ts` is not proven by a test that reads the app's real output, and a storage key could reach a log line through the `Key`/`Resource` properties of an S3 SDK error that Nest logs whole.
- **V68**: the arm64 image build runs under QEMU and can hang until the job's 30-minute timeout, so a `:main` image can silently fail to publish. Fix: build each platform on a native runner and merge the manifests.
- **V73**: `GET /` still answers the Nest scaffold's `Hello World!`, and `HttpCatalogClient` calls `fetch` without a timeout, so a Catalog that accepts the connection and never answers holds the request open.
