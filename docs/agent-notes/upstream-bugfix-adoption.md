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
| Write-side flush identity, exact-content and metadata verification for state/artifacts | `2e38a66` | Product-only repair on the existing file-safety/Windows tree. Keep the shared state-module helper, both call sites and write race tests together; rebuild Host output. |
| Probe login-file symlink/identity/hardlink rejection and bounded read/post-read verification; 120 normal-check regressions | POSIX portability from `53454e7`, then `49865b0`, `4499ca4`; normal test wiring in `336076f`; read-side review repair `2cc098b` | Adopt both readers, their test module and the test-script hunk together. `4499ca4` assumes identity checks/test helpers from `49865b0`; those reader hunks also assume the preceding Windows portability shape. |

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
   [write/flush race tests](../../tests/adaptive-task-write-identity.spec.ts),
   [artifact read/reuse tests](../../tests/adaptive-task-artifact-identity.spec.ts),
   [manual read/dispatch tests](../../tests/adaptive-task-read-stability.spec.ts),
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
   [129 reader/binding cases](../../scripts/native-compaction-login-tests.mjs),
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

## Earlier route-gap review repair

Commit `4b30858` changes only the recovery component, its browser regressions and
the rebuilt Client artifact. It assumes the prior UI state/ref structure; it is
an incremental repair on this PR, not a standalone patch on clean main. For clean
main, use the complete final component/browser-test difference in adoption unit 2.

The earlier review concerns a first read during route disposal/re-registration.
The control now makes at most three initial GETs, with abortable 250/500 ms
backoff, before concluding 404/405 absence. Missing bodies are not parsed. A
recovered route exposes the existing task; confirmed ordinary conversations stay
entry-free. Later gaps still require explicit re-read, writes are never replayed,
and session replacement cancels pending backoff. This is a bounded retry policy,
not perpetual monitoring or a guarantee that arbitrarily delayed routes recover
without a remount.

## Earlier write/read-side review repairs

The product write-side repair `2e38a66` belongs to adoption unit 1. Do not retain
only `53454e7`'s writable flush handles without the current verification follow-up. Atomic-write SDK fsync
is explicitly out of scope and its return value does not expose the written inode.
The shared flush check therefore verifies regular/single-link bigint path and
opened-handle identity/metadata, reads only the expected content length plus one
sentinel byte and compares exact serialized bytes before sync. It verifies the
handle and path again after sync before returning a reservation/state/digest.
Keep the helper in the state module and both state/artifact call sites together;
copying only the artifact call site leaves an unresolved import. This is not a
new atomic-write implementation or an SDK/version change.

The independent probe read-side repair `2cc098b` belongs to adoption unit 4. It
does not depend on `2e38a66`, but assumes the earlier probe identity/link checks. Both readers
use at most 512 KiB plus one sentinel byte and revalidate path/handle link counts,
bigint identities, sizes, nanosecond mtime/ctime and security metadata before
credential decoding/return. Partial reads are supported; size growth, truncation,
valid-account rewrites, link changes and post-read stat failures reject and close
handles. Keep the updated 120-case test module with the two readers; the older
mock readFile-only fixture cannot exercise the new bounded-read contract.

## Final boundary repair following `b7239a0`

The follow-up closes three new reports together with the adjacent state-reader
P2 found by independent whole-chain review. Earlier `2e38a66`/`2cc098b` are
prerequisites/provenance, not sufficient final repairs on their own.

| Problem | Final adoption group / dependency |
| --- | --- |
| Parent selection versus separately stable child login reads | Durable reader plus the current login test module (120 reader cases and 9 binding cases). Both write/resume children consume the parent's original fingerprint from overridden private env before provider setup; no hash in state/argv/report. |
| Replacement while POSIX directory commit or file close completes | Shared state-module flush helper and both state/artifact callers together. Directory open/sync/close and file close precede the final path validation inside the writer lock. Callers must not add later durability operations. |
| Stale existing artifact accepted on reuse | Final artifact get/put plus [artifact identity tests](../../tests/adaptive-task-artifact-identity.spec.ts). Bigint read/post-close checks and observed-absence handling are required; reuse also runs the same exact-content/durability helper, without rewriting unsafe targets. |
| Manual state consumption bypasses write-side verification | Final state reader, identity tests and [read/dispatch stability tests](../../tests/adaptive-task-read-stability.spec.ts). Read/post-close metadata/path checks precede codec parsing; actual control/legacy/manual reads are exercised, not stubbed successful. |

A safe same-owner private atomic replacement gets **one read-only retry**, whether
observed while reading or during close. The old bytes are discarded; repeated
replacement, unsafe/link targets or disappearance after any observation fail
unavailable, not missing-state fallback. No command/provider mutation is replayed.

Use these complete final source/test groups on current main, not an isolated
caller/helper hunk or an old generated bundle. Rebuild and validate every adopted
subset; the combined PR checks and independent review do not certify a selective
cherry-pick recipe, real OS concurrency, live acceptance or immunity to arbitrary
same-user changes after the final observation point.
