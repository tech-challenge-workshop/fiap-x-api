# Observability Validation

**Date**: 2026-09-28
**Spec**: `.specs/features/observability/spec.md`
**Diff range**: `origin/main..HEAD` = `2ab4ba3..da37a60` (4 docs commits + 16 task commits + 1 style commit; 36 files, +2700/-20)
**Verifier**: independent sub-agent (author ≠ verifier)

---

## Task Completion

| Task | Status  | Notes |
| ---- | ------- | ----- |
| T1–T16 | ✅ Done | All 16 task commits present in range; each Done-when gate re-verified below. T8/T9 route-e2e consolidated into the T16 sweep per the matrix exception documented in tasks.md. |

---

## Spec-Anchored Acceptance Criteria

> Note on numbering: this spec defines 13 ACs (OBS-01..13, per its Requirement Traceability table: "13 total, 13 mapped to tasks"). OBS-14/15 do not exist in this repo's spec — the OBS-01..15 range is split across the 5 sibling repos.

| Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + assertion | Result |
| ------------------------- | -------------------- | ----------------------- | ------ |
| OBS-01 WHEN any request THEN assign correlationId (inbound `X-Correlation-Id` if non-blank and ≤128 printable ASCII, else generated) and make it available to every log line of the request | Valid id echoed verbatim; invalid replaced with generated uuid; every captured line of the request carries the same id | `test/observability.e2e-spec.ts:264` - `expect(res.headers['x-correlation-id']).toBe('demo-123')`; `:287-291` - overlong (129) replaced: `expect(echoed).not.toBe(overlong); expect(echoed).toMatch(UUID)` and replacement propagated to catalog; `:301-303` - blank replaced, `expect(echoed).toMatch(UUID)`; `:316-322` - `for (const line of lines) { ... expect(parsed['correlationId']).toBe('demo-123') }` on every captured line | ✅ PASS |
| OBS-02 WHEN the API emits any log line THEN one JSON object carrying at least `timestamp`, `level`, `msg`, `service`, via the shared pino instance | `timestamp` numeric, `level` present, `msg` string, `service: 'fiap-x-api'` | `src/observability/logger.config.spec.ts:69-74` - `expect(typeof line['timestamp']).toBe('number'); expect(line['level']).toBe(30); expect(line['msg']).toBe('hello world'); expect(line['service']).toBe('fiap-x-api')`; e2e `test/observability.e2e-spec.ts:317-321` - `JSON.parse(line)` per line + service/timestamp/msg assertions (non-JSON output would throw) | ✅ PASS |
| OBS-03 WHEN the API calls the Catalog over HTTP THEN forward the request's correlationId in `X-Correlation-Id` | Header on the wire equals the request's id | `test/observability.e2e-spec.ts:275` - `expect(catalog.creates[0].headers['x-correlation-id']).toBe('demo-123')` (real HTTP fake); unit `src/processing-requests/adapters/http-catalog-client.adapter.spec.ts:353-369` - `expect(captures[0].headers['x-correlation-id']).toBe('corr-123')` | ✅ PASS |
| OBS-04 WHEN the API confirms an upload THEN include the request's correlationId so the Catalog persists/propagates it | `correlationId` body field === edge id; recorded on the created request | `test/observability.e2e-spec.ts:276` - `expect(catalog.creates[0].body.correlationId).toBe('demo-123')`; `src/uploads/complete-upload.service.spec.ts:53-59` - `expect(createSpy).toHaveBeenCalledWith(..., 'corr-confirm')`; `src/processing-requests/adapters/in-memory-catalog-client.adapter.spec.ts:41-55` - `expect(recorded).toMatchObject({ correlationId: 'corr-abc' })` | ✅ PASS |
| OBS-05 IF inbound id blank, >128 chars, or non-printable THEN replace with generated id and SHALL NOT fail the request | Blank/129+/control-char → generated uuid; request still 201/200 | `src/observability/correlation-context.spec.ts:60-62` - 128 accepted (`toBe(id)`); `:66-67` - `expect(parseCorrelationId('')).toBeNull(); expect(parseCorrelationId('   ')).toBeNull()`; `:71-73` - `expect(parseCorrelationId('x'.repeat(129))).toBeNull(); expect(parseCorrelationId('demo\n123')).toBeNull()`; e2e `:279-292` (129 → 201 + uuid echo), `:294-304` (blank → 201 + uuid echo) | ✅ PASS |
| OBS-06 WHEN a log line is emitted for a request carrying an owner email claim THEN the line SHALL NOT contain the email; redaction SHALL cover it mechanically | No `alice@fiapx.local` anywhere in captured logs; redact config covers `email`/`ownerEmail` keys at root and one level | e2e `test/observability.e2e-spec.ts:347` - `expect(text).not.toContain('alice@fiapx.local')`; unit `src/observability/logger.config.spec.ts:93-97` - `expect(line).not.toHaveProperty('email'); expect(line['account']).toEqual({}); expect(logger.raw.join('')).not.toContain('alice@example.com')` | ✅ PASS (depth caveat → ⚠️ flag below) |
| OBS-07 SHALL NOT emit an access-log line for `/health`, `/health/live`, `/metrics` | Zero access-log lines for exactly those three endpoints | e2e `test/observability.e2e-spec.ts:377-378` - `expect(text).not.toContain('request completed'); expect(text).not.toContain('request errored')`; unit `src/observability/logger.config.spec.ts:123-134` - hits all three + control path `/healthz`, `expect(lines).toHaveLength(1)` | ✅ PASS |
| OBS-08 `GET /metrics` → 200, `Content-Type: text/plain; version=0.0.4`, set includes the four families | Exact content type; `fiapx_http_requests_total{method,route,status}`, `fiapx_http_request_duration_seconds`, `fiapx_uploads_total{outcome}`, `fiapx_downloads_total{outcome}` present | `test/observability.e2e-spec.ts:247` - `expect(res.headers['content-type']).toBe('text/plain; version=0.0.4')`; `:248-255` - `expect(res.text).toContain('# HELP ${family}')` for all four; unit `src/observability/metrics.controller.spec.ts:28-29` status + exact content type; `:42-51` exact series strings | ✅ PASS |
| OBS-09 WHEN an upload is rejected at the edge THEN increment `fiapx_uploads_total{outcome="rejected"}` and NOT `accepted` | Rejected → `rejected 1`, no `accepted` series; mix → exactly `accepted 1`/`rejected 1` | `src/uploads/start-upload.service.spec.ts:37-38` - `expect(exposition).toContain('fiapx_uploads_total{outcome="rejected"} 1'); expect(exposition).not.toContain('outcome="accepted"')`; e2e `test/observability.e2e-spec.ts:406-407` - `expect(res.text).toContain('fiapx_uploads_total{outcome="accepted"} 1'); ...{outcome="rejected"} 1` | ✅ PASS |
| OBS-10 WHEN a download by non-owner or non-`COMPLETED` THEN increment `fiapx_downloads_total{outcome="denied"}` | Denied → `denied 1` for both 404 and 409 causes | `src/processing-requests/services/download.service.spec.ts:52-54` (409) and `:64-65` (404) - `expect(exposition).toContain('fiapx_downloads_total{outcome="denied"} 1')`; e2e foreign-owner flow → `test/observability.e2e-spec.ts:409` | ✅ PASS |
| OBS-11 `GET /health` → 200 while serving | 200 `{status:'ok'}` | `test/observability.e2e-spec.ts:236-238` - `.get('/health').expect(200, { status: 'ok' })` | ✅ PASS |
| OBS-12 `GET /health/live` → 200 while event loop responsive, independent of external deps | 200 `{status:'ok'}` | `test/observability.e2e-spec.ts:239-241` - `.get('/health/live').expect(200, { status: 'ok' })`; independence is structural (handler is a static literal, no injected dependency — `src/health/health.controller.ts:13-16`) | ✅ PASS |
| OBS-13 metric exposition and health endpoints SHALL NOT require authentication | 200 on all three without a JWT | `test/observability.e2e-spec.ts:235-256` (no Authorization header on any of the three calls); unit `src/observability/metrics.controller.spec.ts:54-61` - `expect(isPublic).toBe(true)` via `IS_PUBLIC_KEY` metadata | ✅ PASS |

**Status**: ✅ All 13 ACs covered and matched to spec-defined outcomes — 2 ⚠️ spec-precision flags below (observations, not coverage gaps).

**Spec-precision flags (imprecise spec, judged outcome-met):**

1. ⚠️ **OBS-06 redaction depth**: the spec does not bound the nesting depth redaction must cover; pino/fast-redact wildcard paths mechanically cover root + one nesting level only (`src/observability/logger.config.ts:13-24`, including the two documented SPEC_DEVIATION bare-key additions). The spec-defined outcome (no email in any line of a request carrying the email claim) is met and e2e-proven with real traffic; a hypothetical depth-≥2 log argument would survive. Sensor M1 additionally showed the e2e passes even with email redaction fully removed (no current code path logs the email), so the unit spec owns this assertion. Accepted: documented limitation, outcome preserved.
2. ⚠️ **Edge case "concurrent `/metrics` scrape must not block request handling"** (`spec.md:91`): no concurrency assertion exists; the non-blocking property is structural (dedicated `Registry`, synchronous snapshot — `src/observability/metrics.ts:60-62`). The e2e exercises `/metrics` after a traffic mix, not concurrently with in-flight requests. Accepted: structural guarantee, no test discriminates it.

Both SPEC_DEVIATION markers in `src/observability/logger.config.ts` (bare root redact keys; `service` moved from `customProps` into the mixin) were judged outcome-preserving — each makes the literal spec outcome (OBS-06 at root depth; OBS-02 on root-instance lines) hold where the design text alone would have failed it.

---

## Discrimination Sensor

Scratch isolation: each mutation in a fresh `git worktree add /tmp/fiapx-sensor-mN HEAD` (node_modules symlinked, never installed/copied into the real tree), subset run there, worktree removed with `--force`; `git status --porcelain` re-verified empty against the pre-sensor baseline after every mutation. All mutations applied only via shell to the scratch copy.

| Mutation | File:line | Description | Killed? |
| -------- | --------- | ----------- | ------- |
| 1 | `src/observability/logger.config.ts:13-24` | Removed all four email redact paths (`email`, `ownerEmail`, `*.email`, `*.ownerEmail`) | ✅ Killed — unit `logger.config.spec.ts:93` fails (1 failed/8). Note: e2e `never logs the owner email` survives this mutant (no current code path emits the email), so the unit spec owns this assertion |
| 2 | `src/observability/correlation-context.ts:8` | Header bound `{1,128}` → `{1,200}` | ✅ Killed — unit `correlation-context.spec.ts:71` fails (`'x'.repeat(129)` accepted); e2e `replaces an overlong correlation id` also fails |
| 3 | `src/observability/metrics.controller.ts:7` | Removed `@Public()` → global JwtAuthGuard 401s the scraper | ✅ Killed — unit `metrics.controller.spec.ts:60` fails; e2e loses 3 tests (`GET /metrics 200 without a token`, `no access log for excluded endpoints`, `four metric families…`) |
| 4 | `src/observability/logger.config.ts:46-51` | Mixin returns only `{ service }` — correlationId never injected | ✅ Killed — unit `logger.config.spec.ts:74` fails; e2e `logs one JSON line per event, every line carrying the correlation id` fails |
| 5 | `src/uploads/start-upload.service.ts:32` | `recordUpload('rejected')` → `recordUpload('accepted')` | ✅ Killed — unit `start-upload.service.spec.ts:37-38` fails; e2e traffic-mix `…{outcome="rejected"} 1` fails |

**Sensor depth**: lightweight (5 targeted behavior-level mutations, exceeding the 1–3 default)
**Result**: 5/5 killed — PASS ✅

---

## Interactive UAT Results

Not performed — backend/observability feature; automated checks (unit + e2e + sensor) are sufficient per validate.md §3/§7.

---

## Code Quality

| Principle | Status |
| --------- | ------ |
| Minimum code / no scope creep | ✅ 36 files, all in the feature surface (new `src/observability/*`, touched upload/download/catalog-client seams, tests, `package.json` + lock) |
| No abstractions for single-use code | ✅ `ApiMetrics`/`CorrelationContext` are small concrete classes; no speculative layers |
| Matches existing patterns/style | ✅ port/adapters threading mirrors the S7 ownerEmail pattern; commit-per-task Conventional Commits; prettier style commit present |
| Spec-anchored outcome check | ✅ all 13 AC assertions target spec-defined values (see table) |
| Per-layer coverage (domain 1:1 ACs; routes happy+edge+error) | ✅ matrix honored; the T8/T9 route-e2e consolidation into the T16 sweep is documented and every new route is asserted there |
| Every test maps to an AC/edge/Done-when | ✅ new tests trace to OBS-01..13 + spec edge cases |
| Documented guidelines followed | ✅ `.github/workflows/ci.yml` gates (lint `--max-warnings 0`, typecheck, unit, e2e fail-on-skipped, build) all re-run green by this Verifier |

Changed-test integrity: the 5 existing catalog-call assertions in `test/complete-upload.e2e-spec.ts` / `test/processing-requests.e2e-spec.ts` were strengthened (new 5th arg bound to the response's `x-correlation-id`), not weakened; the route-pin list gains exactly the two mandated routes (`GET /health/live`, `GET /metrics`) and excludes only the middleware `{*splat}` catch-alls.

---

## Edge Cases

- [x] Overlong `X-Correlation-Id` replaced, request proceeds (e2e, 129 chars → 201 + uuid)
- [x] `req.headers.authorization` redacted (unit + e2e `never logs the bearer token`)
- [x] owner email under any `email`/`ownerEmail` key redacted (unit; depth caveat flagged above)
- [ ] ⚠️ `/metrics` scraped concurrently with traffic → no blocking: not explicitly tested (structural registry snapshot only) — flagged as spec-precision observation
- [x] pretty-print misconfig would fail CI (every log-shape test `JSON.parse`es each line)
- [x] zip storage key never logged (e2e asserts no `zipStorageKey`/`zips/` in captured logs)

---

## Gate Check

- **Gate command**: `npm test` (quick) and `npm run test:e2e` (full), plus `npm run lint && npm run typecheck && npm run build` (build gate)
- **Results (all exit codes captured directly)**:
  - `npm test` → exit 0 — Test Suites 19/19, Tests 199 passed, 0 failed, 0 skipped
  - `npm run test:e2e` → exit 0 — Test Suites 13/13, Tests 153 passed, 0 failed, 14 skipped (ran twice; no V40 flake observed on either run)
  - `npm run lint` → exit 0; `npm run typecheck` → exit 0; `npm run build` → exit 0
- **Test count before feature**: 88 unit + 77 e2e (`it(` count, origin/main tree)
- **Test count after feature**: 135 unit + 89 e2e (+47 unit, +12 e2e = +59; matches tasks.md T1–T16 claims exactly)
- **Delta**: +59 new tests, 0 deletions, 0 weakened assertions
- **Skipped tests**: 14 — all inside the pre-existing `(endpoint ? describe : describe.skip)` RustFS/`STORAGE_TEST_ENDPOINT` gate in `test/s3-upload-storage.e2e-spec.ts:53`; identical gate at origin/main; unchanged by this feature
- **Failures**: none

---

## Fix Plans (if issues found)

None required. Observations (non-blocking, for the record):

1. ⚠️ OBS-06 redaction depth is root + one level (pino/fast-redact wildcard limit; documented in code and tasks.md T2). A future depth-≥2 log argument carrying an email would survive redaction. Mitigation exists structurally (no current path logs the email — sensor M1 proved it), but a spec-G-era lint/guard on log call-site shapes would close it fully.
2. ⚠️ Concurrent-scrape non-blocking edge case has no discriminating test; the guarantee is structural (per-app `Registry` snapshot).

---

## Requirement Traceability Update

| Requirement | Previous Status | New Status |
| ----------- | --------------- | ---------- |
| OBS-01..13  | Verified (author) | ✅ Verified (independent Verifier, evidence above) |

---

## Summary

**Overall**: ✅ Ready (PASS, 2 spec-precision observations)

**Spec-anchored check**: 13/13 ACs matched spec outcome; 2 ⚠️ spec-precision flags (both judged outcome-met)
**Sensor**: 5/5 mutations killed
**Gate**: unit 199/199, e2e 153 passed + 14 pre-existing env skips, lint/typecheck/build green — all exit 0

**What works**: full correlation chain (edge → ALS → pino mixin → Catalog header + body, e2e-proven on the wire); invalid-header replacement for blank/overlong/control/non-string; mechanical PII redaction (authorization, cookie, email/ownerEmail, storage keys); access-log exclusion for the three endpoints; exact Prometheus exposition contract with all four families; upload/download outcome counters at every edge including idempotent-replay and 502 no-count semantics; readiness/liveness split, all unauthenticated.

**Issues found**: none blocking. Two documented observations above.

**Next steps**: merge-ready; route the two ⚠️ observations to spec G (test-hardening) if depth-2 redaction or a concurrency scrape test is wanted.
