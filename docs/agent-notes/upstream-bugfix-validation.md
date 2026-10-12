# Task recovery and Windows maintenance fixes — 2026-10-12

## Source identity and scope

Base: upstream `main` at `f1d1745e3705c7ecef30675d6857a01c1bde93ea`.
The `fix/upstream-bugs` delivery includes the existing commits `f8998c8`
(routeless published recovery) and `53454e7` (Windows verification/flush fixes),
plus the route-lifecycle and artifact-file fixes described below. Verification
was performed on the working tree based on `53454e753d8c513167903074ac0354848c51b47c`,
with Node `v24.21.0` on Windows and installed DSH test dependencies
`0.1.7-rc.1`. This is not live-account or installed-Desktop acceptance.

The shipping surface remains recovery-only. No experimental feature is enabled,
no host permission or authentication rule is relaxed, and no saved session,
account, grant, archive or checkpoint is migrated or removed.

## Fixes and regression evidence

1. A host responding `404`/`405` without a task endpoint no longer displays an
   unconfirmed recovery entry. The existing browser regression is
   `tests/browser/adaptive-task-publication.browser.client.spec.tsx`.
2. Windows flushes use writable handles; POSIX-only mode/uid assertions remain
   on POSIX; file-link rejection is explicit where `O_NOFOLLOW` is ineffective;
   the packaging check resolves the Windows npm shim through the shared command
   helper. Compatibility fixtures derive declared values rather than widening
   supported versions. History migration remains explicitly dry-run-only on
   Windows; its unsupported apply cases are not represented as passing.
3. `src/adaptive-task-http.ts` binds its route disposer to the owning context
   effect. `tests/adaptive-task-http.spec.ts` exercises two consumer lifecycles
   on one real WebServer, confirms that duplicate registration is still rejected
   while active, and that unrelated routes survive disposal. The service is
   constructed without listening or initializing an account.
4. `src/adaptive-task-artifacts.ts` rejects non-regular files and symlinks with
   `lstat` and compares the opened file's device/inode identity. Both `get` and
   the existing-artifact path of `put` reject links.
   `tests/adaptive-task-evidence.spec.ts` adds matching-content and dangling-link
   fixtures, asserting that neither the link nor its outside target is replaced.
   Existing hash, size, hardlink and permission checks remain.

The artifact correction prevents a link from being accepted as a durable private
artifact. It does not demonstrate a hash bypass, account authorization bypass or
privilege escalation; the plugin does not provide an additional host sandbox.

## Commands and outcomes

The following commands were executed directly using the already installed local
tools, without installing dependencies or changing runtime/profile settings:

```text
node node_modules/typescript/bin/tsc -p tsconfig.json
node node_modules/typescript/bin/tsc -p tsconfig.client.json
node node_modules/eslint/bin/eslint.js src --max-warnings=0
node scripts/check-source-lint.mjs
node scripts/lint.mjs
node node_modules/tsdown/dist/run.mjs
node scripts/check-env-proxy-import.mjs
node scripts/check-compatibility.mjs
git diff --check
```

All exited `0`. Important output:

```text
Source lint gate: 6 invalid cases rejected; 2 valid cases accepted
release metadata: 44 regression cases passed
Pinned OAuth source, JWT decoding, callback cleanup and refresh rejection patches verified
Build complete (host declarations, host bundle, standalone CLI and client)
environment proxy import: {"node":"v24.21.0","dispatcher":"EnvHttpProxyAgent","preserved":true}
custom v1 import, unrelated fetch and ownership passed
```

Generated `lib/index.js` was rebuilt by tsdown, not hand-edited. Other generated
outputs were unchanged from this branch's committed outputs.

Two additional inline checks used
`node --experimental-transform-types --input-type=module` and exited `0`:

- Real Cordis Context and WebServer registration: two consumer unload/reload
  cycles removed only the task route, allowed its re-registration, retained an
  unrelated route, and made no request or listening socket.
- Real artifact/evidence/store/atomic-write modules with only the Node filesystem
  replaced in memory: ordinary read/reuse passed; matching and dangling symlinks
  were rejected before artifact opening or writing; changed file identity was
  rejected; no disk writes or credentials were involved.

The inline checks are supplemental evidence, not execution of the Vitest suite
or native Windows filesystem acceptance.

## Verification limitations

On the preceding unmodified source head `53454e7`:

- `pnpm run test` failed before invoking Vitest because pnpm's dependency check
  attempted installation and could not open its SQLite store database.
- `node node_modules/vitest/vitest.mjs run` failed before loading tests because
  the system temporary directory rejected module-runner directory creation
  (`EPERM`). No test assertions ran.
- The focused browser recovery command using `vitest.browser.config.ts` failed
  before running tests because Playwright's temporary-directory creation was
  rejected (`EPERM`).

On the repaired working tree:

- `node scripts/check-pack.mjs` exited `1`; npm reported that its cache log
  directory could not be written. No successful package validation is claimed.
- The Vitest and browser regressions have been added/typechecked but were not
  rerun through a changed temporary path or execution channel.
- `pnpm run check`, frozen-lockfile installation, full native filesystem tests,
  supported-host matrices and live-account acceptance remain uncompleted.

No temporary-directory, npm-store or Windows permission repair was performed.
A clean CI environment must run the full check and relevant browser suite before
merge. No historical passing head is used as evidence for the repaired tree.

## CI follow-up: synchronize the test harness and exact inventories

[The first PR CI run](https://github.com/franksong2702/dsh-codex-connect/actions/runs/38228519538)
on `7eb79e4` exposed three omissions in that commit, not runner failures:

- Both validate jobs reported ten HTTP publication failures because their mock
  context lacked the newly required `effect` factory and registration disposer.
- The authenticated-browser acceptance wrapper still required six tests after
  the lifecycle regression increased its successful report to seven.
- Both Phase 2 jobs rejected an otherwise successful first-host test report
  because the exact case inventory omitted the two new artifact-link cases.

The baseline [main CI run](https://github.com/franksong2702/dsh-codex-connect/actions/runs/38038162968)
passed all six corresponding jobs. On the PR head, the HTTP suite (six tests),
artifact suite (30 tests) and browser UI test step passed; later acceptance
steps were blocked by the omissions above. This does not prove that the later,
unexecuted steps pass.

The follow-up changes only the unit mock, authenticated UI totals (exactly seven
passed, zero pending/todo) and the two named inventory entries. No runtime,
bundle, release gate or safety assertion is removed or relaxed.

Local follow-up verification, using the same installed Node runtime:

```text
node node_modules/typescript/bin/tsc -p tsconfig.json       exit 0
node node_modules/typescript/bin/tsc -p tsconfig.client.json exit 0
node --check scripts/check-adaptive-task-ui.mjs            exit 0
git diff --check                                          exit 0
```

Supplemental inline checks also exited zero: the original updated unit harness
ran ten HTTP activation/exit/read/authentication scenarios against the real
handler; the actual matrix report inspector accepted the complete synthetic
inventory and rejected missing/extra/failed/pending/todo evidence. The UI wrapper
still requires exactly seven total and passed tests. These are not a Vitest,
browser or installed-host matrix rerun. The earlier local temporary-directory
blocker was not bypassed; exact follow-up-head CI acceptance remains pending.

## Build follow-up: platform-independent CLI source labels

[CI on the test-harness follow-up](https://github.com/franksong2702/dsh-codex-connect/actions/runs/38233614225)
finished with five successful checks and two failed validate jobs. Both validate
jobs passed tests, persistence/crash checks, package validation and declared-host
matrices, then failed only the final committed-build check with `M lib/bin.js`.

The installed pnpm layout records version 10.33.0 and a maximum virtual-store
directory length of 60. CI uses pnpm 10.30.3 on Ubuntu, whose default is 120;
both pnpm versions use the same platform-dependent defaults and shortening
algorithm. Seven committed region labels match the shortened directory names.
Restoring just those labels in memory produces 310,551 bytes / 83,114 gzip bytes,
matching CI's displayed 310.55 kB / 83.11 kB. The CI run uploaded no build artifact,
so the actual Ubuntu blob was not available for a complete byte comparison.

Starting from `0d27be5`, only the existing standalone CLI configuration adds
`inputOptions.experimental.attachDebugInfo: 'none'`. Installed tsdown 0.23.0 and
Rolldown 1.2.8 types and runtime bindings support the setting. The default comment
policy is unchanged: this is not `comments: false`, minification, a handwritten
bundle patch, a dependency reinstall or a relaxed CI check. The option is
experimental and should be revalidated when the bundler is upgraded.

Authorized local verification on Node v24.21.0 / Windows:

- The normal tsdown build ran three times; all builds exited zero and the complete
  nine-file output inventory and SHA-256 hashes were identical across runs. The
  additional standalone repeat-build assertion also exited zero.
- A full JavaScript AST comparison against the source baseline matched every
  output after normalizing only references to the owned renamed helper chunks.
  All 1,565 parsed non-region comments were unchanged; declarations, host,
  client and Undici output were byte-identical. CLI region labels were removed.
- An initial context-free scanner probe exited one because it did not handle
  JavaScript regex/template context correctly. It was replaced by the complete
  parser comparison above, which exited zero; no product check was weakened.
- The real CLI help exited zero. A keyless capability invocation against a
  verified nonexistent synthetic home returned the expected exit one / rejected
  OAuth state with `probe: not-requested`, then exited naturally without creating
  a profile. This is a passing offline assertion, not a live-provider probe.
- A separate virtual-module in-memory check on Rolldown 1.2.8 showed that changing
  the pnpm directory ID changes default region labels; disabling debug attachment
  made the outputs identical while retaining `@license`, `@preserve` and JSDoc.

```text
node node_modules/typescript/bin/tsc --noEmit --strict --target es2024 --module nodenext --moduleResolution nodenext --skipLibCheck tsdown.config.ts  exit 0
node node_modules/typescript/bin/tsc -p tsconfig.json        exit 0
node node_modules/typescript/bin/tsc -p tsconfig.client.json exit 0
node node_modules/eslint/bin/eslint.js src --max-warnings=0 exit 0
node scripts/check-source-lint.mjs                         exit 0
node scripts/lint.mjs                                      exit 0
node scripts/check-env-proxy-import.mjs                    exit 0
node scripts/check-compatibility.mjs                       exit 0
```

Only the CLI and its two generated helper chunks changed; their content-derived
filenames and owned imports were regenerated together. Runtime source, locks,
licenses/notices, versions, host/client configuration and the CI gate are
unchanged. No full Vitest/browser/pack or installed-host matrix rerun is claimed
for this local build follow-up; earlier temporary-directory/cache blockers were
not bypassed. A new exact-head Ubuntu CI run is still required after separately
authorized commit and push. No live credentials, requests, services or profile
installation were used or changed.

## Automated review follow-up: state-file identity — 2026-10-12

Starting source: `49865b0ee2085a3251c3d88329ffcd906989005e`. The new P2 review
identified a separate Windows race in `AtomicTaskDocumentStore.read`: a path
checked before opening could be replaced before the handle was read. This is
not a recurrence of the already-fixed probe login readers.

The reader now compares bigint device/inode identities across pre-open `lstat`,
the opened handle and post-open `lstat`. Links retain `TASK_STATE_UNAVAILABLE`;
non-regular files and identity mismatches fail with `TASK_STATE_UNSAFE`. A path
that disappears after opening fails unavailable instead of being interpreted
as absent state. Rejections close the handle before any read or document parse.
Existing hardlink, size, POSIX permission and document checks remain intact.

Added `tests/adaptive-task-store-identity.spec.ts` with ten deterministic mocked
cases, including large inode values and post-open disappearance. Project typing
and source ESLint passed. A supplemental in-memory harness transpiled the actual
store source and passed twenty scenarios across mocked Windows/Linux behavior;
it verifies no read/parse on rejection and handle cleanup. This is not a Vitest
run, real filesystem race acceptance or installed-host acceptance. No temporary
paths, permissions or caches were changed to bypass prior local runner blockers.

The standard tsdown build passed and regenerated the host bundle; generated files
were not hand-edited. `git diff --check` passed. Full check, browser/pack and live
acceptance were not rerun locally; exact-head CI remains separate evidence.
No real credentials, live requests, profiles or daily services were used.

## Automated review follow-up: transient route gaps and test wiring — 2026-10-13

Starting source: `f66cd4141632f36752f027a7cf8be90eab382a12`.
The client now treats 404/405 as a routeless host only on the first completed
read response. Subsequent refresh or Stop/manual failures clear unconfirmed
state but retain the recovery dialog and explicit re-read path, including
repeated gaps after the confirmed state was cleared. Stale/aborted responses
cannot update the response-history ref; the session-keyed component resets it.
POSTs still dispatch once, and only read-only readiness failures retain bounded
retries. Initial missing routes remain entry-free without parsing their bodies.

Browser regression coverage exercises both statuses for refresh, Stop and manual
takeover, repeated gaps, restored state and no mutation replay. The existing
session-switch and initial-routeless tests remain. The standalone login tests
are now the first part of `pnpm run test`, so normal CI, full check and release
check invoke them before Vitest without changing its included inventory.

Local outcomes: login-reader tests 40/40; project/client typing, source ESLint,
metadata checks, standard build and diff whitespace checks all exit 0. An
in-memory synthetic-hook harness of the actual transpiled component passed eight
request scenarios and asserted the package/full-check wiring. This does not
claim React rendering/browser acceptance. Full Vitest/browser/pack execution
remains unverified locally due to the previously documented environment blockers;
no bypass or live request was performed. The client bundle was rebuilt, not edited.

## Automated review follow-up: login hardlinks — 2026-10-13

Starting source: `336076f26ee53b90d99065faa9e359215459f59a`. Both probe login
readers now require a single link on the pre-open path, opened bigint identity,
post-open path and final handle stat before reading. A hardlinked or unlinked
file is rejected with the existing redacted unsafe-file error. Normal single-link
files remain accepted; no credential format, account selection, refresh behavior,
platform permissions or network dispatch logic changed.

The normal-check regression suite now passes 60/60 synthetic cases, adding initial
hardlinks, handle/post-open hardlinks, a link added at the final stat and unlinked
handles for both readers and mocked Windows/Linux. Every rejection performs zero
reads and closes any opened handle. Existing identity, symlink, size and POSIX
permission scenarios also pass. Both script syntax checks and `git diff --check`
pass. These are synthetic reader tests, not real-account or live-probe acceptance.
Only scripts/tests and this record changed; product source/bundles need no rebuild.
