# Maintenance continuation — 2026-10-21

This continues the [2026-10-20 handoff execution](../2026-10-20-maintenance/README.md) through current ChatGPT and WebCodex MCP. No Codex CLI, Coding Agent, additional model session, live provider call or WebCodex change was used.

Read-only resumption confirmed the correct GitHub origin, unchanged main `e5579b71339ba932dec7dfba497fc97df8fbf124`, #327 head `a297fa6808982eed57c219a8a3518bd8c37b6761`, #358 head `eec7c892f5dfba21009bcaa71db8f626cbbfa9df`, and existing evidence branch at `a019a1078526aad91ce8a65f9cd175da16167273`. The original working directory and its existing untracked files were preserved. The three existing isolated worktrees were clean before this continuation. Project handoff storage remained disabled; no recorded handoff task or active Runner job was present at the initial check.

## New evidence

| Item | New result | Remaining disposition |
| --- | --- | --- |
| [#358 / #376 lock timing](writer-lock/README.md) | Four predeclared single executions: natural main/candidate 12/12 completed; a single controlled 500-ms first-holder delay caused 9 completions and 3 timeouts on each side. In-memory traces show roughly 1.59 seconds between successive holders in natural runs versus 0.13 seconds total lock occupancy. | Demonstrated retry/backoff mechanism, not proof of the old cloud cause. Production parameters and source unchanged; historical failure and explicit merge hold retained. |
| [#327 actual locked Linux store](pr327-locked-native/README.md) | Unchanged packed artifact, genuine native Locked=true, installed status/migration refusals, same-daemon unlock, key identity/recovery and cleanup passed in 11 CLI calls after a documented fixture-control correction. Initial failure preserved. | Bounded locked Linux read/migration/recovery covered; independent review still explicitly retains draft/unmerged status. Windows and other listed native/deployment limits remain. |
| [#65](https://github.com/franksong2702/dsh-codex-connect/issues/65) | Read back Open with exactly oversized-user retention/recall and checkpoint-only retry scope. | No new experiment, claimed resolution, local Host change or official Host delivery claim. |

## Interpretation

The writer diagnosis preserves all six controlled timeout outcomes. A successful diagnostic process means the planned observation and cleanup completed, not that all writers succeeded. No concurrency reduction, deadline change, source patch or result-based diagnostic rerun occurred.

The locked-store fixture's first recovery control failed despite daemon-command exit zero. It did not verify entry-by-entry cleanup, but its entirely owned container/private filesystem was removed. After correcting only the native control path, the full sequence passed and both entries were verified absent. These two outcomes remain distinct.

All production code and generated bundles are unchanged in this evidence continuation. Local source/package identity, syntax, JSON/hash integrity, publication and packaging checks are recorded alongside the artifacts. The separate evidence PR's exact new-head CI outcome is maintained in its GitHub description/comment after publication; old-head success is not substituted.

## Authorization and remaining decisions

All native operations used fake credentials and independent entries owned by the tests. No real account/profile, daily installation/restart, release, force push or scanner suppression occurred. No work was done in the separately maintained WebCodex project.

#327 still needs an independent acceptance conclusion on the additional evidence. #358 still needs an explicit disposition of the historical cloud failure for the test-only cleanup change; the unknown original executor cannot be recovered from the current Mac Runner. These remaining decisions are retained on GitHub instead of being claimed complete.
