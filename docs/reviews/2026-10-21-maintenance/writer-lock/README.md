# Writer-lock timing evidence — 2026-10-21

## Result and disposition

The unchanged main and #358 candidate show the same bounded contention behavior. In each natural 12-writer run, all 12 reservations completed. A single explicitly injected 500-ms hold in the first mutation callback caused **9 completed reservations and 3 writer-lock timeouts on each side**. Every result is preserved; no run was repeated.

This identifies synchronized retry/backoff as a demonstrated mechanism that can exhaust the existing wait budget even when the sum of useful lock occupancy is well below two seconds. It does **not** establish that this was the cause of the historical cloud failure. #358 still changes only fixture draining, and #376 retains the original-cloud evidence gap. No merge waiver or production fix is asserted by this report.

## Exact identities and method

- Main source: `e5579b71339ba932dec7dfba497fc97df8fbf124`.
- Baseline execution worktree: documentation-only `a019a1078526aad91ce8a65f9cd175da16167273`.
- Candidate: `eec7c892f5dfba21009bcaa71db8f626cbbfa9df`.
- Store, contract, lockfile and Vitest configuration were compared byte for byte with main before execution and checked for changes afterward.
- Actually loaded atomic-write package: `0.1.7-rc.1`, module SHA-256 `eafd9dd0129d925a674530d1d4a22454914ed90449efd1710ee93e5cf4a36a91`, identical in all four executions.
- Store SHA-256: `3d5c9ec0b3cdb8e09e2cf76ced7cc1f8efd2182b544fa8ff478d896a944246c6`.
- Fixture SHA-256: `5aedef6ce1e22f9150d4aa2bda980ef0dc3a19d9996fb361a3ea2e170ae73e7f`.
- macOS arm64, Darwin 27.2.0, Node 22.22.3, ten available processors, runtime-default libuv threadpool, filesystem type 26. Runs began between 2026-10-21 00:02:45 and 00:02:51 UTC.
- [Predeclared plan](PLAN.md), [driver](run.py), [in-memory instrumentation](instrumented-store.mjs), [all identities/outcomes](results/summary.json), [computed interval analysis](results/analysis.json).

Each case launches twelve updates within one millisecond; there is no serial submission or worker/threadpool reduction. The real 2,000-ms acquisition default and 20→40→80→160→200-ms retry cadence are unchanged. The clock is not mocked. The two control cases add a real asynchronous 500-ms callback wait only to the first acquired writer.

This diagnostic invokes the production store directly. It does not run the Vitest test file or recreate the full-suite workload. Its own all-settled collector drains every writer before inspection/cleanup on both sides. Existing separate negative-control evidence establishes the #358 cleanup behavior.

## Observed timing

| Case | Completed / timeout | Sum of observed holds | Sum of gaps between holders | Longest successful acquisition wait |
| --- | ---: | ---: | ---: | ---: |
| Main, natural | 12 / 0 | 132.067 ms | 1,592.799 ms | 1,717.288 ms |
| Candidate, natural | 12 / 0 | 135.934 ms | 1,593.558 ms | 1,718.863 ms |
| Main, first holder +500 ms | 9 / 3 | 607.366 ms | 1,525.937 ms | 2,118.832 ms |
| Candidate, first holder +500 ms | 9 / 3 | 605.075 ms | 1,525.533 ms | 2,120.217 ms |

A hold is measured from successful lock-file write completion through lock-file removal completion. A gap is the previous removal completion to the next successful lock write completion; it includes the next exclusive-create I/O. These are observable promise-completion intervals, not kernel scheduler traces.

Natural file-plus-directory sync time totals were 97.648 ms on main and 97.570 ms on the candidate. Individual natural holds were at most 14.944 / 18.025 ms. In the controlled cases, the first hold was 514.609 / 514.061 ms; later gaps were about 187–196 ms. The long interval is therefore visible largely as retry cadence gaps rather than continuously occupied lock time in these runs.

The dependency checks the deadline after a failed acquisition attempt. An acquisition that succeeds on the next attempt may therefore complete beyond the nominal two-second deadline; the traces preserve that existing behavior. No timeout option was supplied or widened.

## Interpretation and limits

The first synchronized wave can leave many contenders on the same capped retry schedule. Releasing the lock does not wake them; they wait for their own next timers. Twelve short successful updates already consume approximately 1.7 seconds of acquisition time in this fixture. A bounded delay can move remaining contenders beyond the failure deadline even though the combined observed hold duration is only about 0.61 seconds.

That causal mechanism was produced on both exact source roots. The artificial delay is not evidence that the historical cloud process had the same delay, filesystem behavior or CPU scheduling. Instrumentation adds AsyncLocalStorage, promises, timestamps and in-memory event allocation; its overhead was not independently quantified and it can perturb scheduling. Both sides use the same wrapper. Desktop/background load was observed, not controlled. No inference about original cloud architecture, CPU quota or filesystem is made.

The production lock helper comes from the Host atomic-write peer dependency; #358 does not modify it. Any fairness/retry/coordination fix needs a separately scoped change and evidence preserving cross-process mutual exclusion, durability, failure propagation and ownership. This report does not change the production timeout or reduce concurrent writers.

## Completion and remaining gate

All four diagnostic processes completed their integrity checks. Persisted reservation counts exactly matched successful writers, the lock was absent after draining, and each temporary fixture was removed. The controlled cases retain all six observed timeout outcomes; process exit zero denotes completed diagnostic/cleanup, not twelve successful writes.

The original cloud executor identity, workload and lock trace remain unavailable through the current Mac WebCodex connection. #376 should distinguish this **demonstrated mechanism** from the **unattributed historical failure**. The #358 merge disposition remains explicit and separate; green checks and this diagnostic do not silently approve it.
