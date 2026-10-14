# Manual proxy input draft ownership

## Scope

Follow-up to #332, prepared for main after dependency repair #333 (`3933ddfd42422bbe050a4b723a0a16f79c22fa62`). Implementation was delegated to gpt-6.1-sol and independently reviewed by Astra.

- Manual input has separate local ownership, not configuration mutation authority. Typing alone cannot enable Save, apply a proxy, issue a probe or write Host settings.
- A different typed candidate survives unrelated Host revisions and unrelated successful settings saves. Untouched input follows the accepted Host proxy.
- Discard restores the latest accepted value and invalidates pending probes. Scope replacement clears the old candidate and probe state.
- Exact accepted text releases local ownership, including after Use/Save and when typing back to the accepted text. Merely normalized-equivalent text remains an input draft. A genuinely different tested candidate survives an unrelated save with its valid result.
- Probe cancellation/generation fencing, normalized-address matching, explicit tested Use, revision/conflict checks, reset masks, readonly/memory restrictions, catalog recovery and Host refusals remain intact. No dependency/API/Task/default changes are part of this UI fix.

## Review correction

The first implementation kept manual ownership after a successful proxy save. Astra identified that Discard would remain enabled and later Host proxy updates would not refresh the otherwise clean input. Sol reproduced two failing regressions and added conditional exact-text ownership release. The two failures then passed, together with the distinct-candidate preservation case. All original nine regressions remain; three correction regressions were added.

Worker focused acceptance: 10 files / 139 tests, including 59 settings tests; typecheck and diff checks passed. These results precede the final dependency-baseline update and do not replace final parent acceptance.

## Final acceptance

Parent Astra fast-forwarded to merged main `3933ddfd42422bbe050a4b723a0a16f79c22fa62`, verifying the two implementation/test files and this review note retained their hashes during the baseline update. Dependencies were restored from the approved patched lock offline, frozen and with lifecycle scripts disabled.

Fresh independent gates on Node 24.13.0 / macOS arm64, pnpm 11.7.0 and development SDK 0.1.7-rc.1 / Cordis 4.0.4:

- `pnpm run check`: exit 0; **139 files / 1,786 tests**, including lint, both typechecks, build, contracts/imports/CLI and pack checks.
- `pnpm run test:browser`: exit 0; **12 files / 58 Chromium tests**.
- Actual authenticated Product/Task Chromium gate: exit 0; all nine required scenarios and zero real provider calls. Task remains paused.
- Rebuilt client diff matches only the reviewed input-state/probe changes; other generated artifacts and the patched dependency graph are unchanged. Diff whitespace check passed.

These are synthetic/local acceptance results. No real Desktop, OAuth/model or daily-profile acceptance is claimed. Real Desktop remains explicitly deferred to an independently isolated test machine; no installation or publication is authorized by these gates.

## Unexpanded observation

The pre-existing global settings draft is synchronized only while not dirty/busy; replacement of a scope may retain that global staging. This is a source-level observation, not an independently reproduced production defect. This change confines scope-reset behavior to the manual input and probes and does not broaden the global configuration lifecycle.
