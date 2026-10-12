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
