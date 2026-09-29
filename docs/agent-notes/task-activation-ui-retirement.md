# Retire experimental activation UI — 2026-09-29

The public contribution is now structurally recovery-only, rather than choosing between recovery and the full experimental form. Remove `AdaptiveTaskControl.tsx`, `TaskDelegationConsent.tsx` and the two browser suites whose sole subject was that retired form. Their last retained source is available in the parent Git history and the maintainer's local research archive; historical evidence hashes are not rewritten.

Dependency inspection found only the published conditional branch and those two test suites importing the removed form. No package dependency is exclusive to these React components; React and the host client packages remain required elsewhere. The recovery component, its bilingual/phone-width/late-response/no-replay tests, HTTP activation rejection, owner validation, existing task counters, backend runtime and all task lifecycle tests remain.

The displayed explanation now says frozen, not awaiting acceptance. Old tasks keep authorized Stop/manual takeover and readback. Ordinary conversations remain entry-free. No configuration, saved grant, archive, checkpoint or session data is deleted. Restoring the obsolete form from Git does not authorize enabling it.

Required checks are browser recovery regression, full repository check/build and packaged artifact validation, followed by normal exact-head CI. Removing this UI is not full server orchestration removal; the legacy server implementation still supports historical-state safety until a separately verified recovery-only replacement exists.

Local Node 24.13.0 verification passed: `pnpm run check` (133 files / 1,537 tests, lint/typecheck/build, import/CLI/metrics and packaging) and `pnpm run test:browser` (11 files / 53 tests). The reduction from 73 browser tests is the deliberate retirement of 20 tests for the removed activation/consent forms, not weakened recovery assertions. The preserved recovery suite additionally verifies the frozen wording in both languages. No actual account/model requests or daily services were used.
