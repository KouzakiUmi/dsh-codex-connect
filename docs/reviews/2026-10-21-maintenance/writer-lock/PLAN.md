# Bounded writer-lock diagnostic — declared 2026-10-21

This is a four-case diagnostic for #358 / #376, using the unchanged production store and installed `@deepseek-ai/dsh-atomic-write` module. It is not a new Task experiment, full-suite rerun or replacement for original-cloud evidence.

## Fixed plan before execution

1. Exact-main production source, 12 simultaneous writers, no added delay.
2. Exact-candidate production source, the same 12-writer fixture, no added delay.
3. Exact-main production source, 12 simultaneous writers, one explicitly injected 500-ms asynchronous hold inside the first acquired mutation callback.
4. Exact-candidate production source, the same single 500-ms hold.

Execute each case once, in that order, and preserve every outcome. Do not retry based on success/failure. A controlled hold is a mechanism probe, not a claim that the historical cloud holder experienced this delay.

The baseline execution worktree is documentation-only commit `a019a1078526aad91ce8a65f9cd175da16167273`. Before execution, compare its store, contract, lockfile and Vitest configuration byte for byte with main `e5579b71339ba932dec7dfba497fc97df8fbf124` and candidate `eec7c892f5dfba21009bcaa71db8f626cbbfa9df`. Hash the actually loaded dependency. Both source worktrees remain unchanged.

## Instrumentation and limits

Use per-process in-memory events around the native fs functions, FileHandle operations and timers, associated with the twelve callers through AsyncLocalStorage. Record failed/successful exclusive-create attempts, mutation entry, file/directory sync, release, completion and all timer observations. Restore wrappers and drain every writer before deleting only this diagnostic's temporary fixture.

The real 2,000-ms default, retry schedule, wall clock and 12 simultaneous calls remain unchanged. No worker or threadpool override is introduced. The 500-ms callback delay is explicit only in the two control cases. Instrumentation adds promise/array/clock overhead and can perturb scheduling; its overhead is not independently quantified. Both sides use the same instrumentation. The diagnostic does not reproduce the original full-suite workload or identify its unknown architecture/filesystem/load.

Only synthetic task state is written. No OAuth, provider/model call, user credential, installed daily profile or Host/WebCodex modification is involved. Historical failures and merge holds remain until the resulting evidence supports a distinct acceptance decision.
