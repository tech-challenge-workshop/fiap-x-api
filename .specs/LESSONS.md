# LESSONS - auto-maintained by scripts/lessons.py

> Machine-owned. Do NOT hand-edit. Changes are overwritten on the next `lessons.py` write.
> Canonical state lives in `.specs/lessons.json`. Edit lessons only via the script.
> promote_threshold=2 distinct features · window_days=45 · quarantine_threshold=2

## Confirmed (load these at Specify/Design)

Corroborated across multiple features. Safe to apply as guidance.

_none_

## Candidates (under observation - do NOT load as guidance yet)

Seen once or not yet corroborated. Tracked, not trusted.

### L-001 - toThrow/MockRejectedValue + toMatchObject(new HttpException(msg, STATUS)) does not assert the HTTP status code; assert err.getStatus().toBe(STATUS) so a status-code mutation is killed at the unit layer, not only at e2e.
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `src/processing-requests` · harmful: 0
- features: initial-vertical-slice
- evidence: src/processing-requests/services/create-processing-request.service.spec.ts:59 (src/processing-requests)
- last seen: 2026-08-27T23:37:11Z

### L-002 - Nest test fixture get<TOKEN> is a TS type error when TOKEN is a Symbol value, not a type; use the concrete class generic (get<InMemoryCatalogClient>) and ensure tsconfig.build does not exclude test files from the type-check gate, else TS2749 slips past build+lint.
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `test` · harmful: 0
- features: initial-vertical-slice
- evidence: test/processing-requests.e2e-spec.ts:26 (test)
- last seen: 2026-08-27T23:37:16Z

### L-003 - When a requirement holds for a duration, advance the clock in the test instead of asserting only right after setup
- signal: `surviving_mutant` · recurrence: 1 feature(s) · harmful: 0
- features: auth-owner-scope
- evidence: M11b src/auth/signing-key-cache.ts:29; src/auth/signing-key-cache.spec.ts:45-54
- last seen: 2026-09-26T04:08:33Z

### L-004 - Test a rejection rule with an input that only that rule rejects, otherwise a later check hides its removal
- signal: `surviving_mutant` · recurrence: 1 feature(s) · harmful: 0
- features: auth-owner-scope
- evidence: M22 src/auth/jwt-auth.guard.ts:20; test/auth.e2e-spec.ts:95-96
- last seen: 2026-09-26T04:08:33Z

## Quarantined (failed when applied - ignore)

A confirmed lesson that recurred alongside failure. Kept for the maintainer to review.

_none_
