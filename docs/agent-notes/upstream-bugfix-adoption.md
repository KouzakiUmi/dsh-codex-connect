# PR #330: remaining fixes and selective adoption

Baseline: upstream `7b34dd5` (#331 and #332 already merged). This is a bug-fix
contribution, not a personal feature branch or a proposal to reopen Task.

## What remains useful

- Windows flush/command portability, regular-file safety and conservative Task
  state failure semantics are not replaced by OAuth storage PR #327 or exact
  alpha.2 compatibility PR #328.
- Task route disposal/authentication is already on main through #331; do not
  describe that production change as unique to #330 or overwrite it with old code.
- Recovery UI addresses initial missing routes and transient gaps. It does not
  claim to resolve every symptom of #314, especially no-live-root 409 entry policy.
- Probe login-file checks are optional acceptance-tool hardening, not a fix for
  #65's oversized-user recall/checkpoint scheduling observations.

## Historical commit-to-problem map

These are provenance references, **not a tested independent cherry-pick recipe**.
Several commits mix scopes or assume earlier commits; old generated output must
not be used to replace a newer Host/Client bundle wholesale.

| Problem / final behavior | Historical commits | Selective adoption guidance |
| --- | --- | --- |
| Windows writable flush handles; POSIX-only assertions; Windows npm shim; compatibility-derived doctor fixture; dry-run-only migration tests; journal link rejection | `53454e7` | Compound commit with old generated artifacts. Adopt relevant final source/checker/test hunks and rebuild; preserve main's pack inventory checker. |
| Artifact symlink/read-reuse rejection and matching/dangling-link regressions | `53454e7`, `7eb79e4`, two named cases from `0d27be5` | Retain artifact source/tests and case inventory. Route disposal from `7eb79e4` is already superseded by #331. Do not restore the old fixed UI test count from `0d27be5`. |
| State path/handle bigint identity checks and fail-unavailable after observed state disappears | `f66cd41`, state-specific portion of `c2e234a` (plus writable flush in `53454e7`) | Adopt final state source and identity/admission tests together. `c2e234a` is a merge commit, not a standalone state-fix cherry-pick. |
| Initial routeless entry suppression; later gaps preserve recovery; initial gaps get bounded GET retries | `f8998c8`, `336076f`, `4b30858` | Adopt final recovery component and browser suite together. `336076f` also wires login tests into package scripts; it is not UI-only. |
| Platform-independent standalone CLI source debug labels | `4b7c406` | The configuration setting is independent; this historical commit also renames/rebuilds chunks. Keep future keyring externalization and rebuild all CLI output. |
| Probe login-file symlink/identity/hardlink rejection; 60 normal-check regressions | POSIX portability from `53454e7`, then `49865b0`, `4499ca4`; normal test wiring in `336076f` | Adopt both readers, their test module and the test-script hunk together. `4499ca4` assumes identity checks/test helpers from `49865b0`; those reader hunks also assume the preceding Windows portability shape. |

`1e5c1bd` and `c2e234a` have two parents. Blind `cherry-pick -m 1` includes
upstream integration, while `-m 2` includes accumulated branch changes. Neither
is the minimal state-only patch. `0d27be5` is an old fixture repair, not the
current named-report contract. Do not indiscriminately cherry-pick the entire
historical sequence on current main.

## Recommended adoption units on current main

Prefer reviewing the **final difference from the baseline**, selecting one
coherent source/test group, committing it on the maintainer's branch and rebuilding.
This avoids carrying obsolete route/authentication and UI-count implementations.

1. **Product state/artifact safety:**
   [state store](../../src/adaptive-task-store.ts),
   [artifact store](../../src/adaptive-task-artifacts.ts),
   [identity/admission tests](../../tests/adaptive-task-store-identity.spec.ts),
   [artifact tests](../../tests/adaptive-task-evidence.spec.ts), and
   [named Phase 2 cases](../../scripts/adaptive-task-delegation-cases.json).
2. **Recovery UI:** [component](../../src/client/PublishedAdaptiveTaskControl.tsx)
   and [browser regressions](../../tests/browser/adaptive-task-publication.browser.client.spec.tsx).
3. **Windows checks/diagnostics:** the relevant final changes in
   [pack checker](../../scripts/check-pack.mjs),
   [doctor contract](../../scripts/check-dsh-next-contract.mjs),
   [metrics reader](../../src/request-metrics-report.ts),
   [history tests](../../tests/history-migration.spec.ts), and POSIX-only probe guards.
4. **Probe safety:** [durable reader](../../scripts/native-compaction-durable-smoke.mjs),
   [Luna reader](../../scripts/native-compaction-luna-smoke.mjs),
   [60-case regression](../../scripts/native-compaction-login-tests.mjs),
   [controlled-run portability](../../scripts/native-compaction-controlled-cases.mjs)
   and only the normal test-script hunk in [package metadata](../../package.json).
5. **CLI build reproducibility:** only the standalone debug-label option in
   [build config](../../tsdown.config.ts), followed by a complete rebuild.

The Windows flush changes belong with the product safety group if that group is
adopted on Windows. Probe safety and generic check portability can be omitted
from a product-only adoption, but their tests must not remain wired to absent files.

No selective combination or historical cherry-pick has been executed/accepted by
this guide. The full PR was tested as a combined tree. Every adopted subset needs
its own typecheck, focused tests, full check, browser checks where affected and
fresh generated-build/pack validation. Do not widen supported versions, remove
safety assertions or hand-edit generated chunks to make a subset pass.

## Current review repair

Commit `4b30858` changes only the recovery component, its browser regressions and
the rebuilt Client artifact. It assumes the prior UI state/ref structure; it is
an incremental repair on this PR, not a standalone patch on clean main. For clean
main, use the complete final component/browser-test difference in adoption unit 2.

The latest review concerns a first read during route disposal/re-registration.
The control now makes at most three initial GETs, with abortable 250/500 ms
backoff, before concluding 404/405 absence. Missing bodies are not parsed. A
recovered route exposes the existing task; confirmed ordinary conversations stay
entry-free. Later gaps still require explicit re-read, writes are never replayed,
and session replacement cancels pending backoff. This is a bounded retry policy,
not perpetual monitoring or a guarantee that arbitrarily delayed routes recover
without a remount.
