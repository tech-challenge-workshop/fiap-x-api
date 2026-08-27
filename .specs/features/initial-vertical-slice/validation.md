# initial-vertical-slice Validation

**Date**: 2026-08-27
**Spec**: `.specs/features/initial-vertical-slice/spec.md`
**Diff range**: `f6ae296..HEAD` (commits e78f7fb..31a4617, 8 commits)
**Verifier**: independent sub-agent (author ≠ verifier)

---

## Task Completion

| Task | Status   | Notes |
| ---- | -------- | ----- |
| T1: Create request DTO with validation | ✅ Done | DTO + 6 unit tests |
| T2: Create response DTO               | ✅ Done | 1 field, no status |
| T3: Define CatalogClient port         | ✅ Done | interface returns `Promise<string>` |
| T4: InMemoryCatalogClient stub        | ✅ Done | success + rejection paths |
| T5: CreateProcessingRequestService     | ✅ Done | delegates, maps rejection to 502 |
| T6: Controller + e2e                   | ✅ Done | POST route, 5 e2e tests |
| T7: Global ValidationPipe             | ✅ Done | `whitelist`+`forbidNonWhitelisted`+`transform` |
| T8: Lint + build gate                 | ✅ Done | both pass |

All 8 tasks marked done; none blocked or partial.

---

## Spec-Anchored Acceptance Criteria

| Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + assertion expression | Result |
| ------------------------- | -------------------- | ---------------------------------- | ------ |
| AC1: WHEN API receives controlled request with `ownerUserId` + `sourceStorageKey` THEN it SHALL delegate one creation command to the Catalog | Catalog `createProcessingRequest(owner, source)` invoked once | `src/processing-requests/services/create-processing-request.service.spec.ts:42-45` - `expect(spy).toHaveBeenCalledWith('user-123','videos/clip.mp4')` | ✅ PASS (single-call implied; `toHaveBeenCalledTimes(1)` not asserted — minor) |
| AC2: WHEN Catalog accepts THEN return `processingRequestId` without assigning processing status | response has only `processingRequestId`, no status field/state | `src/processing-requests/services/create-processing-request.service.spec.ts:46` - `expect(result).toEqual({ processingRequestId: 'pr-123' })`; `test/processing-requests.e2e-spec.ts:42-43` - `expect(body.processingRequestId).toContain('user-123')` | ✅ PASS |
| AC3: IF `ownerUserId` or `sourceStorageKey` absent THEN reject before calling Catalog | HTTP 400 before Catalog invocation (ValidationPipe) | `test/processing-requests.e2e-spec.ts:47-70` - `.expect(400)` for missing owner / missing source / missing both; `src/processing-requests/dtos/create-processing-request.dto.spec.ts:17-69` - validation rejects missing/empty fields | ✅ PASS (catalog-not-called not explicitly asserted; architecturally guaranteed by ValidationPipe running before controller) |
| AC4: IF Catalog rejects THEN return failure outcome and SHALL not publish a processing event | HTTP 502; no event publication code exists | `test/processing-requests.e2e-spec.ts:72-82` - `catalogClient.setNextRequestShouldReject(true)` then `.expect(502)` | ✅ PASS |

**Status**: ✅ All 4 ACs covered with `file:line` evidence.

---

## Discrimination Sensor

Sensor depth: lightweight (1-3 targeted behavior-level mutations on highest-risk new code).
Run in an isolated git worktree at `/tmp/fiapx-sensor` (HEAD detached); real worktree never mutated; `git stash` not used. Baseline `git status --porcelain` was empty before and identical after cleanup.

| Mutation | File:line (scratch) | Description | Killed? |
| -------- | --------- | ----------- | ------- |
| M1 | `src/processing-requests/services/create-processing-request.service.ts:29` | Flipped status `HttpStatus.BAD_GATEWAY` (502) → `HttpStatus.INTERNAL_SERVER_ERROR` (500) | ✅ Killed by e2e (`.expect(502)`); ❌ **SURVIVED unit** — `toMatchObject(new HttpException(...,BAD_GATEWAY))` does not assert the numeric status |
| M2 | `src/processing-requests/services/create-processing-request.service.ts:25` | Returned `{ processingRequestId: 'hardcoded-id' }` instead of the Catalog-provided id | ✅ Killed by unit (`toEqual({processingRequestId:'pr-123'})`) and e2e (`toContain('user-123')`) |
| M3 | `src/processing-requests/adapters/in-memory-catalog-client.adapter.ts:15` | Flipped condition `if (this.shouldReject)` → `if (!this.shouldReject)` | ✅ Killed by unit (reject + happy tests) and e2e (502 test + happy test) |

**Result**: 3/3 killed at the Full gate (`npm test && npm run test:e2e`). One mutation (M1) survived the **unit** layer but was caught by the **e2e** layer — recorded as a weak-assertion quality gap (not an AC gap; AC4 is e2e-covered).

**Isolation check**: `git worktree remove --force /tmp/fiapx-sensor` succeeded; real worktree `git status --porcelain` empty post-cleanup = matches baseline.

---

## Edge Cases

- [x] Duplicate creation input: the API leaves duplicate-handling to the Catalog — `InMemoryCatalogClient` increments `idSequence` and never dedupes (`in-memory-catalog-client.adapter.ts:19`), consistent with the spec edge case. No explicit dup test, but the edge case is a "leave to Catalog" policy the code satisfies by omission.

---

## Code Quality

| Principle | Status |
| --------- | ------ |
| No features beyond what was asked | ✅ |
| No abstractions for single-use code | ✅ |
| No unnecessary "flexibility" added | ✅ |
| Only touched files required for task | ✅ |
| Didn't "improve" unrelated code | ✅ |
| Matches existing patterns/style (NestJS scaffold) | ✅ |
| Would senior engineer approve? | ✅ (with minor cleanups below) |
| Tests map to ACs and are non-shallow | ✅ (spot-check: AC1↔service.spec:42, AC4↔e2e:81) |
| Spec-anchored outcome check (asserted values match spec) | ✅ |
| Per-layer Coverage: domain 1:1 ACs; routes happy+edge+error | ✅ (happy: e2e:32; validation edge: e2e:47-70; error/502: e2e:72) |
| Every test in scope maps to a spec AC / edge case / Done-when | ✅ (no unclaimed tests) |
| Documented guidelines followed: `package.json` jest/lint scripts, `README.md`, service boundary doc | ✅ |

---

## Gate Check

- **Gate command (Full)**: `npm test && npm run test:e2e`  (Build gate T8: `npm run build && npm run lint`)
- **Unit (`npm test`)**: 4 suites passed, 12 tests passed, 0 failed, 0 skipped.
- **E2e (`npm run test:e2e`)**: 2 suites passed, 6 tests passed (1 pre-existing `app.e2e-spec.ts` + 5 new), 0 failed, 0 skipped.
- **Build (`npm run build`)**: exit 0.
- **Lint (`npm run lint`)**: exit 0, no warnings.
- **Test count before feature** (`f6ae296`): unit 1 (`app.controller.spec.ts`), e2e 1 (`app.e2e-spec.ts`).
- **Test count after feature**: unit 12, e2e 6.
- **Delta**: +11 unit, +5 e2e (count increased; no deletions; no weakened assertions).
- **Skipped tests**: none.
- **Failures**: none.

---

## ESLint `**/._*` Ignore — AppleDouble Assessment

The volume (`/Volumes/HIKSEMI`) emits macOS AppleDouble metadata files (`._*`) pervasively — `find` shows them across `dist/`, `.git/`, and `.specs/features/initial-vertical-slice/._tasks.md`. The change in `31a4617` adds exactly one entry, `'**/._*'`, to `eslint.config.mjs:9` `ignores`:

- `**/._*` is the canonical glob for AppleDouble files (resource-fork sidecars prefixed `._`).
- Scope is minimal: only the ESLint `ignores` array; no rule, config, or other tooling touched.
- Currently no `._*.ts` exists inside the lint glob `{src,apps,libs,test}/**/*.ts`, so the entry is **preventive** rather than fixing an immediate lint failure — but it is justified and idiomatic given the volume demonstrably produces these files.
- It does not mask any real source issue (AppleDouble files are foreign binary metadata, not TypeScript).

**Verdict**: ✅ Yes — `**/._*` is a minimal, correct, and idiomatic correction for AppleDouble metadata. The smallest possible change (one glob), scoped to ESLint, no scope creep.

---

## Fix Plans (non-blocking minor gaps)

### Fix 1: TypeScript type error in e2e test (uncaught by gate)

- **Root cause**: `test/processing-requests.e2e-spec.ts:26` uses `moduleFixture.get<CATALOG_CLIENT>(CATALOG_CLIENT)`. `CATALOG_CLIENT` is a `Symbol` value, not a type. `npx tsc --noEmit -p tsconfig.json` reports `TS2749: 'CATALOG_CLIENT' refers to a value, but is being used as a type here`. The build gate does not catch it because `tsconfig.build.json` excludes `test` and `**/*spec.ts`; ESLint does not flag TS type-semantic errors; ts-jest runs the file (the generic is erased at runtime, and the runtime argument `CATALOG_CLIENT` is correct).
- **Fix task**: Change `get<CATALOG_CLIENT>` → `get<InMemoryCatalogClient>` (line 27 already casts `as InMemoryCatalogClient`, so the generic is redundant). Optionally add a typecheck-include-tests step to a gate command so such errors surface.
- **Verify**: `npx tsc --noEmit -p tsconfig.json` exits 0; `npm run test:e2e` still passes.
- **Priority**: Minor.

### Fix 2: Service unit test does not assert the HTTP status

- **Root cause**: `create-processing-request.service.spec.ts:59-61` asserts `.rejects.toMatchObject(new HttpException('Catalog rejected creation', HttpStatus.BAD_GATEWAY))`. `toMatchObject` on an `HttpException` does not reliably compare the numeric status (mutation M1: 502→500 survived the unit test). The AC is still covered at the e2e layer (`e2e-spec.ts:81` `.expect(502)`), so this is a weak-assertion quality issue, not an AC gap.
- **Fix task**: Assert the status explicitly, e.g. `expect(err.getStatus()).toBe(HttpStatus.BAD_GATEWAY)` and `expect(err.message).toBe('Catalog rejected creation')`.
- **Verify**: Re-run sensor M1 against the unit test only — it should now fail.
- **Priority**: Minor.

### Fix 3 (observation, optional): Service catch-all collapses design's 502/500 distinction

- **Root cause**: `create-processing-request.service.ts:26` `catch {}` maps every thrown error to `HttpStatus.BAD_GATEWAY`. The design (`design.md` Error Handling Strategy) distinguishes Catalog rejection → 502 from unexpected error → 500 (NestJS default). In this slice only the Catalog path exists, so it is practically correct, but an unexpected error would wrongly surface as 502.
- **Fix task** (deferred): Re-throw non-Catalog errors, or narrow the catch to the Catalog-rejection sentinel, so unexpected errors fall through to the default 500 filter.
- **Priority**: Minor (cosmetic for this slice; relevant once more error sources exist).

---

## Requirement Traceability Update

| Requirement | Previous Status | New Status |
| ----------- | --------------- | ---------- |
| API-01 | Done | ✅ Verified |
| API-02 | Done | ✅ Verified |
| API-03 | Done | ✅ Verified |
| API-04 | Done | ✅ Verified |

---

## Summary

**Overall**: ✅ Ready
**Result**: PASS ✅

**Spec-anchored check**: 4/4 ACs matched spec outcome with `file:line` evidence; 0 spec-precision gaps.
**Sensor**: 3/3 mutations killed at Full gate (1 survived unit layer, caught by e2e — Fix 2).
**Gate**: 12 unit + 6 e2e passed, 0 failed; build + lint exit 0.

**What works**:
- Controlled creation delegates owner + source key to the Catalog port (AC1).
- Response carries only `processingRequestId`; no processing status or transition logic anywhere (AC2, success criterion).
- Missing/empty `ownerUserId` or `sourceStorageKey` rejected with 400 before the Catalog is reached (AC3).
- Catalog rejection returns 502; no event publication code exists (AC4).
- Build + lint + unit + e2e gates green; test count grew (+11 unit, +5 e2e), none weakened.
- ESLint `**/._*` ignore is a minimal, idiomatic AppleDouble correction.

**Issues found** (all Minor, non-blocking):
1. e2e test TS type error (`get<CATALOG_CLIENT>`) uncaught by build/lint gate — Fix 1.
2. Service unit test does not assert HTTP status (M1 survived unit) — Fix 2.
3. Service catch-all maps unexpected errors to 502 vs design's 500 — Fix 3 (optional/deferred).

**Next steps**: Apply Fix 1 and Fix 2 (small, same-file edits) before the next slice; Fix 3 can defer until a second error source appears.
