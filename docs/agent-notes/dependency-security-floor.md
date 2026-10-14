# Scoped dependency security floors

This change refreshes this repository's local development dependency graph and raises the allowed product Undici floor without changing its locked implementation:

- DSH attachment fixture → Sharp 0.35.5, with its optional native packages at 0.35.5 and libvips packages at 1.3.4.
- DSH webserver fixture → compression 1.8.2 (including its required destroy 1.2.0 dependency).
- jsdom → Undici 7.29.1; product Undici remains 8.11.2, which was already patched. The direct manifest floor rises from `^8.10.0` to `^8.10.2`.
- PostCSS/css-tree → source-map-js 1.2.2; minimatch → brace-expansion 5.0.12.

All patches fit their existing parent ranges. The initial targeted `pnpm update --depth Infinity` unexpectedly refreshed unrelated transitives; that result was discarded. Temporary consumer-specific resolution constraints generated the narrow lock change, then were removed from workspace and lock metadata. No permanent override, new direct transitive dependency, SDK/Node/React/pi-ai change or product logic change remains. Unrelated deprecation-metadata churn was removed.

**This local dev-lock remediation DOES NOT repair externally installed Host Sharp or compression.** Host runtime dependency resolution/repackaging remains upstream-owned. A green local test does not certify another Host installation or GUI bundle. Nested KaTeX 0.16.47 remains deferred: its parent's `^0.16.0` range does not accept the fixed 0.18 line, so no cross-minor override is introduced.

Regression coverage resolves versions from each actual consumer, keeps jsdom on Undici 7 and product on 8, requires loaded Sharp librsvg >=2.63.2 and retains libheif >=1.23.2. Ordinary raster/AVIF normalization, CSS map lookup, lint brace matching and isolated DOM events use harmless fixtures. Existing image/UI/proxy cancellation and response-lifecycle suites are the focused integration gates; no exploit payload, real provider or profile access is used.

Fullcheck/build, review, commits and push remain parent Astra's responsibility. Other optional platform artifacts are lock inventory, not executed compatibility evidence.

## Historical verification failures

Node v24.13.0 was used for focused tests. The initial frozen, script-disabled install passed supply-chain verification for all 641 lock entries and exited 0, but optional `@img/sharp-libvips-darwin-arm64@1.3.4` repeatedly failed to download (transport error 23 / ECONNRESET). pnpm nevertheless returned 0 and left a dangling native dependency link. An ordinary repeat install skipped the repair; a non-optimistic frozen install attempted only the missing package, but its transport retries also failed. No policy was lowered and no lifecycle scripts were run.

That historical focused gate was **not green**: 17 files, 140 tests passed and 43 failed, exit 1. All eight consumer-version floors, manifest floor, CSS map, brace pattern and isolated DOM regressions passed. The 7 native dependency tests and 36 existing native image integration tests failed because Sharp could not load `libvips-cpp.8.18.7.dylib`. Image input/assets and all selected UI/proxy/response-lifecycle/capability/auto-review tests passed. Loaded-version floors and native image behavior were unverified at that point; tests were not waived or skipped.

The original lock inventory/importer and every-snapshot comparison against HEAD passed (exit 0): only the five approved patches, 26 Sharp optional artifacts, required destroy 1.2.0 and direct Undici specifier change remained; unrelated package metadata was unchanged.

## Repair and fresh scoped verification

Parent Astra subsequently repaired the missing artifact with an ordinary serialized frozen, script-disabled install, without lowering policy. Fresh local loading under Node v24.13.0 confirms Sharp 0.35.5, librsvg 2.63.2 and libheif 1.23.5.

Parent's subsequent fullcheck stopped at typecheck, exit 2: TS7016 on the new static `JSDOM` import because jsdom has no installed declaration. The correction uses the existing `createRequire` and a small local interface for only the DOM APIs this fixture uses. No dependency, graph, compiler-policy or assertion changes were made.

Fresh gates after this correction:

- Managed `pnpm run typecheck`: both server/test and client TypeScript checks passed, exit 0.
- `/usr/local/bin/node node_modules/vitest/vitest.mjs run` with dependency security, all image suites (including client gallery/view/turn-tail), view-image, provider/proxy, response-lifecycle, transport-lifecycle, capability-probe and auto-review-probe filters: **28 files, 316 tests passed; zero failures, exit 0**. All 22 dependency-security tests pass, including native loaded-version floors, raster/AVIF normalization, alpha and metadata behavior.
- Fresh loaded-native readback and `git diff --check`: exit 0.

The worker correction performed no install, commit, push, fullcheck or build, and accessed no live provider/profile. The earlier failures above are historical evidence, not the current focused-gate result.

## Independent parent acceptance

Base: merged main `7b34dd543642f8a059b64fee191c23b5d80b1ac7`; Node 24.13.0 on macOS arm64, pnpm 11.7.0, development SDK 0.1.7-rc.1 / Cordis 4.0.4.

- Fresh `pnpm run check`: exit 0, **139 files / 1,774 tests**; includes lint, both typechecks, build, contracts/imports/CLI and pack gates. Native tests were not skipped.
- Fresh `pnpm run test:browser`: exit 0, **12 files / 58 Chromium tests**.
- Actual authenticated Product/Task Chromium gate: exit 0; all nine required scenarios, synthetic provider and zero real provider calls. Task remains paused.
- Independent parsed-lock comparison: only five patch packages, 26 required Sharp artifacts and new `destroy@1.2.0`; all other package metadata and dependency snapshots unchanged. The macOS native artifact integrity matches registry metadata. No generated product artifact changed.
- Independent advisory-range comparison validates all 11 known baseline positives before checking the candidate. Ten no longer match affected versions; only nested KaTeX 0.16.47 remains. GitHub comma-separated comparator ranges are normalized and invalid ranges rejected. This is a candidate-lock result, not proof that remote alerts have closed or installed Hosts have been repaired.

Real Desktop acceptance remains explicitly deferred by the user. Installed Desktop 0.2.0-rc.2 hardcodes port 19387, uses the shared Electron singleton/default session and registers the `dsh` scheme; a new profile alone is not demonstrated full isolation. No second Desktop, candidate installation, live OAuth/model call, signing-policy change or release was performed.
