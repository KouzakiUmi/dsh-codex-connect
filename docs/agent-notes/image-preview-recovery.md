# Recover originals when conversation previews fail

## Implementation contract

- Goal: retain a completed, validated original when only Harness preview persistence fails; expose download and explicit continued editing without another generation.
- Authority: main `bfc2288`, existing image asset/session ownership contracts, and the maintainer's request to improve cross-model image use and recovery.
- Scope: image tool result contract, strict durable/PTC decoding, existing result card, tool/help wording and synthetic regressions.
- Non-goals: no Responses transport replacement, credentials, arbitrary filesystem paths, live-account calls, installation, daily-service changes, release or deployment.
- Plan: preserve existing v1/v2 results; add v3 original-only results for failed previews; keep session-bound selection and download; cover restoration, editing, rejection and cancellation; run focused and full checks.
- Verification: focused Vitest image/host/client suites, `pnpm run check`, and isolated baseline `adaptive-task-store` checks. Network/model responses in tests are synthetic.
- Writeback: record final behavior, exact validation outcomes and limitations here and in the PR.

## Existing behavior and chosen change

The tool already registers independently of the chat provider, has durable image handles, preserves exact originals, and offers original download and editing controls. The missing recovery is after original save: preview failure currently deletes originals and fails the whole result.

Only that failure becomes a successful original-only result, explicitly marked `previewStatus: unavailable` under metadata/envelope v3. Normal v1/v2 results remain unchanged. No preview attachment is fabricated; original-only results use the existing authenticated, session-bound download route and explicit asset target for subsequent edits. Canceled requests and failures before original persistence remain failures and do not grant recovery handles.

## Validation

- Implemented: original-only recovery for thrown, incomplete or invalid preview saves; host validation before original persistence; strict v3 native/PTC decoding; original download and explicit editing in the existing card and completed-turn tail; clearer English/Chinese cross-model help.
- `pnpm run check`: exit 0 on Node `v24.13.0`; 151 Vitest files / 2056 tests passed. Workflow contracts, typed lint, both typechecks, build, import isolation, capability CLI, metrics, compatibility and package checks passed. Built `lib/index.js` and `lib/client.js` are synchronized.
- Focused final image/error regressions: 8 files / 128 tests passed. Additional storage, download-route and edit-transport boundary checks: 3 files / 46 tests passed.
- The complete synthetic DeepSeek host loop verifies tool discovery, unchanged chat provider/model, generation, a preview-unavailable result visible to the next model turn, and an edit consuming the exact retained bytes. No network or real account is used by that fixture.
- Real Host loops with synthetic provider responses persist and cold-load both ordinary and preview-unavailable edit results under uncompressed and zstd JSONL, then edit the retained original. Native/PTC recovery, copied foreign-session metadata rejection, failed validation/original storage and cancellation cleanup are covered. Client tests exercise original download and explicit edit actions without a preview read or automatic generation.
- Baseline `bfc2288` before code changes: 67 targeted tests passed, including `adaptive-task-store.spec.ts`. The reported Node 22 CI writer-lock timeout did not reproduce in this Node 24 targeted run or the final full suite; no lock settings or Task semantics were changed. Upstream CI run `39192296114` at `bfc2288` had only Node 22 validate fail on that lock test; Node 24, both Phase 2 groups, browser, Windows and CodeQL succeeded. The root cause remains unconfirmed. This does not resolve or classify the earlier CI failure as flaky.
- Initial sandbox full checks could not listen on loopback (`EPERM`); the final full check ran with permission for isolated local test sockets. A later in-progress check overlapped final edits and was discarded; only the fixed-source final run is acceptance evidence.

## Limitations and handoff

This is source/isolated synthetic validation, not live OAuth/image-service acceptance, a visual browser acceptance run, an installed Desktop change, or a release. The image endpoint and credential logic are unchanged. No daily Harness window, session, configuration or service was used during implementation. No private custom-plugin code is included. Preview failure can leave host-owned preview objects without published references; this code does not delete shared Host attachments. Original-only recovery deliberately does not retry the image service or reconstruct a preview automatically.

The branch is for independent review as a draft PR; do not merge, publish, install or deploy as part of this iteration.


## Independent review follow-up

Review of `b1e5986` found no blocking implementation defect and requested stronger boundary evidence. The follow-up changes tests only:

- Cancellation during original save or preview save now uses the real temporary asset store, proves the original existed and was readable before cancellation, then asserts original bytes, metadata and the asset directory are physically gone and `read` returns unavailable.
- Native/PTC v3 generation and edit results are exercised through real Session forks and the download route: lawful child/grandchild requests return exact original bytes; copied metadata outside the inherited prefix and inherited failed results return 404.
- `pnpm exec vitest run tests/image-edit-tool.spec.ts tests/image-asset-routes.spec.ts`: 2 files / 57 tests passed. `pnpm run typecheck`: passed. No runtime, permissions or image behavior changed in this follow-up.
- Initial PR CI at `b1e5986`, Node 24 job `117872345767`, passed 2056 tests, build and packaging, then failed resolving `@deepseek-ai/dsh-client-ui-open-in-app@0.1.7-rc.2` because npm registry returned HTTP 502. This is recorded separately from image assertions and the earlier writer-lock failure; it is not evidence that all PR checks passed. The new head's CI still requires completion.
