# UI HTTP deadlines and catalog-independent recovery

## Scope and identity

- PR branch: `fix/ui-http-recovery`. Initial acceptance used base `ce21e710dfdd22790828337f221d2799ec699c4c`. After #331 was squash-merged, the sole UI commit was replayed onto main `fa84fe037119c55cefa77f92ce7df145e0bbc32e`; product source, tests and the built client remained byte-identical. The parent reruns acceptance on this final baseline before merging #332.
- Implementation delegated to the requested `gpt-6.1-sol` workers; the parent reviewer inspected the changes, reproduced a transport-cleanup defect and reran acceptance independently.
- No version bump, Task activation change, new Remote API, Host permission bypass, automatic mutation replay, update-cache change or live profile modification. This is prepared source, not a merged/published/installed release.

## Changes

1. [Shared HTTP reader](../../src/client/request-json.ts) applies one 45-second deadline across headers and JSON/Blob consumption, including transports that ignore abort. Parent cancellation, timeout and early reader failures abort the transport. Timers/listeners are removed; existing account JSON decoding and uncertain-mutation timeout semantics remain intact.
2. [Configuration](../../src/client/OpenAICodexConfiguration.tsx) bounds catalog and proxy reads. Scope changes, supersession, manual-address changes and saved-proxy replacement cancel obsolete requests. Late responses cannot replace current UI state. Catalog failures provide an explicit retry.
3. [Original-image downloads](../../src/client/CodexImageToolView.tsx) cancel on unmount/session/original replacement, retain exact-byte validation, and cannot initiate a late download or leak its object URL. StrictMode effect re-entry remains usable.
4. [Fast Mode](../../src/client/OpenAICodexFastModeToggle.tsx) bounds GET/POST requests. An uncertain write is recovered only through an explicit GET; clicking retry never replays the POST. [Quota reads](../../src/client/OpenAICodexQuotaIndicator.tsx) release their in-flight guard on timeout and retain visibility-aware backoff and no-overlap scheduling.
5. Unchanged, structurally valid Host-accepted context budgets do not require an available model catalog to save unrelated controls. New/edited/removed budgets still require catalog authority. Ordered mutation, latest revision, same-field conflict checks, unrelated concurrent changes, reset/null masks, readonly/memory-mode restrictions and Host refusal handling remain enforced.

## Review closures

- A synthetic HTTP server sent a 403 response and left its body open. The initial helper rejected in the UI but left the transport alive after removing its timer and parent listener. The corrected helper preserves the original error and aborts that transport. The independent rerun observed both `transportAborted=true` and `responseClosed=true`.
- Budget-removal validation and current-proxy identity cleanup were present in the final first handoff. Further regressions confirm deletion remains blocked without catalog authority, and an externally published A-to-B proxy change or disable aborts the obsolete check without discarding other staged edits.
- Existing limitation left unchanged: an unstaged manual proxy text field follows Host snapshot updates when the settings draft is not dirty.

## Independent acceptance

macOS arm64; approved independent Node `v24.13.0`, pnpm `11.7.0`, Vitest `4.1.11`; locked DSH development SDK `0.1.7-rc.1` / Cordis `4.0.4`. Work ran in a nonsynced clone, because the original Documents checkout had `dataless` reads and a Git mmap timeout. Locked dependencies were restored offline without package install scripts. Chromium Headless Shell was downloaded into a temporary test-only cache; no system browser or signing policy was changed.

| Gate | Result |
| --- | --- |
| `pnpm run check` (lint, types, tests, build, contracts, imports, CLI and pack) | exit 0; 139 files / 1,756 tests |
| `pnpm run test:browser` | exit 0; 12 files / 58 Chromium tests |
| Actual authenticated Task-control browser checker | exit 0; all nine required scenarios; synthetic provider, zero real provider requests |
| Independent refused-stream cleanup reproduction | original error preserved; transport aborted and response closed |
| Diff whitespace check | exit 0 |

Documentation-only PR preparation is checked again with metadata lint and pack validation. These tests are not actual Electron protocol/live OAuth acceptance or a fresh supported-Host installation matrix. No merge, release, installation or active Harness reload is implied.
