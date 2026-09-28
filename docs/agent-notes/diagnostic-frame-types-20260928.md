# Diagnostic observer repair — 2026-09-28

## Current delivery scope

Maintenance candidate `0.1.0-alpha.4.51`, based on main `a56109f7c017049089300927d90b6b1dcef80b2d`. Resolves #282 with a string-type guard and transparent error/cancellation lifecycle for the diagnostic wrapper. This branch excludes the unpublished metrics collector, CLI and evaluation framework. No defaults, Task publication gate, accounts or daily services change.

## Defects and reproductions

The existing observer coerced arbitrary JSON `event.type` through `String`, allowing an object to raise a diagnostic-origin TypeError before bytes reached the provider. The original five-case regression recorded one failure before repair and all five passing afterward. The guard stops diagnostic attribution for non-string types while forwarding original response bytes. Two supplemental cases verify direct invalid-type-to-error attribution and cancellation after an invalid frame.

A fresh independent metrics review also exposed a pre-existing diagnostic-wrapper lifecycle problem: an unread or paused consumer could keep a pending `reader.closed` after underlying abort, disposal or network failure. All six new reproductions failed before correction. The wrapper now observes the upstream reader closure, forwards the same error without requiring another read, and guards cancellation/release once. The combined focused suite passed 54 tests. This does not establish a cause for #219's long-lived overloaded condition.

## Independent review and validation

A separate ephemeral GPT-6 Astra process received only the exact source/patch and test code, not implementation chat history. The final combined-correction report returned PASS with no findings. This is static source review, not a claim that the reviewer ran tests. Input/report fingerprints and reviewed file hashes are in [the evidence record](../experiments/evidence/issue-282-final-review-20260928.json).

The aligned candidate completed `pnpm install --frozen-lockfile`, full `pnpm run check` (127 files / 1,466 tests) and Chromium (13 files / 73 tests). The first version-bumped check had one CLI snapshot mismatch; only the displayed version was updated, then the complete check passed. Installation matrix and exact-head remote CI are separate gates; publication is not implied by these local results.

## Historical blocked attempts

The earlier research-workflow final review and commit calls were blocked and produced no completion evidence. The maintainer subsequently authorized continuation. The successful fresh final review above supersedes the pending status; the prior blocked attempts are not represented as passes.

## Release discipline

Use the existing protected OIDC workflow only after the exact candidate is reviewed and both declared stock hosts pass installation. Keep the published recommendation at the already-available version until publication readback succeeds. Published 4.50 bytes/tags must not be rewritten. Source, merge, publication and daily deployment remain distinct.

## Final local candidate results

Both unmodified stock DSH `0.1.7-rc.1` and `0.1.7-rc.2` passed the same-artifact installation/runtime matrix. Candidate version 4.51; archive SHA-256 `4c02b790c749c02d9b9e880d2742b1d04ab433df04d92c5ba94b76b51fa63eee`; defaults unchanged. The archive predates only final evidence-text updates and must not be presented as the eventual OIDC-published artifact identity. Exact-head CI repeats final-tree checks before merge and exact-main CI gates publication. A verified-pair entry was added only after both host results existed.
