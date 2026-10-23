# PR #358: writer cleanup and remaining timeout — 2026-10-20

PR: https://github.com/franksong2702/dsh-codex-connect/pull/358

**Disposition: keep draft / hold merge.** New paired checks passed, but the
earlier cloud full-suite writer-lock timeout has not been causally explained.
No retry-until-green, worker/concurrency reduction or production timeout change
was used. This report preserves the failures and the limits of the comparison.

The continuation tracks the unresolved timeout separately in
[issue #376](https://github.com/franksong2702/dsh-codex-connect/issues/376).
No #358 suite was rerun, no production code changed, and the issue is not a
merge waiver.

## Exact source identities

| Role | Commit |
| --- | --- |
| Main baseline | `e5579b71339ba932dec7dfba497fc97df8fbf124` |
| PR candidate | `eec7c892f5dfba21009bcaa71db8f626cbbfa9df` |

The PR changes only `tests/adaptive-task-store.spec.ts` (+81/-2), adding
settled-writer cleanup and deterministic cleanup regression coverage.
The production implementation, dependency lockfile and test configuration
are byte-identical between the compared commits:

| File | SHA-256 |
| --- | --- |
| `src/adaptive-task-store.ts` | `3d5c9ec0b3cdb8e09e2cf76ced7cc1f8efd2182b544fa8ff478d896a944246c6` |
| `pnpm-lock.yaml` | `779c66fcfa98f2897ddc605932d7045ccd56182f5fd5cc79aa8893f6805758c4` |
| `vitest.config.ts` | `b66dc45147bf03bf1886e505584b567d90a30d298e29354e80a3abb2ea94213b` |

Candidate test SHA-256:
`4468719e7c35148d56f97585082c051d419700b95b6024df7e9e94119377b031`.

## Earlier failures remain failures

- [Pre-PR main job 117867516852](https://github.com/franksong2702/dsh-codex-connect/actions/runs/39192296114/job/117867516852),
  source `bfc2288feea73232e1502bfec744e76392c1cef2`, Ubuntu 24.04.5,
  Node 22.19.0 and pnpm 10.30.3: the 12-writer reservation test timed out
  waiting for its lock, followed by `ENOTEMPTY` during cleanup. This establishes
  that the timeout existed before #358; it does not reproduce the later
  cloud environment. [Public failure excerpt](prior-main-failure.log).
- [Prior candidate cloud acceptance](https://github.com/franksong2702/dsh-codex-connect/pull/358#issuecomment-6285785794),
  Node 24.19.0: an initial run passed tests but failed package validation due
  to npm cache setup. With that setup corrected, the complete check reported
  the existing lock timeout: 2,259 passed, one failed and two skipped; no
  `ENOTEMPTY`. It was not rerun to obtain green.
- [Existing review disposition](https://github.com/franksong2702/dsh-codex-connect/pull/358#issuecomment-6286068675)
  found no blocking code defect but retained the acceptance hold. The current
  readback still shows all ten exact-head checks passing, including CI,
  Dependency Review and CodeQL. [Check snapshot](github-checks.json).
  CI success does not erase the separate cloud failure.

## Predetermined paired comparison

Each pair used both exact source trees and the same installed toolchain.
Dependencies used `pnpm install --frozen-lockfile --ignore-scripts`.
No Vitest worker limit, lowered writer count, production source modification,
timeout increase, or selective test exclusion was introduced. The existing
two skipped tests remain visible.

| Environment and command | Main | Candidate |
| --- | --- | --- |
| macOS arm64 / Node 22.22.3, focused test | 11 passed | 14 passed |
| Same macOS environment, complete `pnpm run check` | 169 files; 2,257 passed, 2 skipped; exit 0 | 169 files; 2,260 passed, 2 skipped; exit 0 |
| Linux arm64 / Node 24.19.0, focused test | 11 passed | 14 passed |
| Same Linux environment, complete `pnpm run check` | 169 files; 2,257 passed, 2 skipped; exit 0 | 169 files; 2,260 passed, 2 skipped; exit 0 |

Both environments used pnpm 10.30.3 and exposed ten CPUs. Linux used one
Docker container for the two complete checks, in main-then-candidate order,
with a native container filesystem for each source tree. The image was pinned
to `node:24.19.0-bookworm`, digest
`sha256:4196d66a565c6f195728d9952f161f4adfe2ad753052a08b7ec7f1c5a6bda42b`.
Only tracked source archives and test-evidence output were mounted, with no
credential/home mount. No existing service was installed or restarted.

The first Linux full-check **invocations did not execute tests**: the container
could execute pnpm by absolute path, but nested package scripts could not find
pnpm in PATH. Both stopped with `sh: 1: pnpm: not found`. Those logs are retained
under [linux-initial](linux-initial). After correcting only the container PATH,
each complete check executed once; focused tests were not repeated.
[The corrected runner](linux-path-corrected/run-pair.mjs) and all comparison logs
are retained. This was a concrete harness repair, not a retry of a failing suite.

## What the comparison establishes, and what remains

The matching production/configuration hashes and the pre-PR failure place the
existing timeout outside the test-cleanup change's implementation scope.
The new runs show no regression in these two paired environments. Settled
cleanup has distinct deterministic regression coverage and must not be
represented as a repair to production lock scheduling.

The lock library's existing default wait is 2,000 ms; its contention backoff
starts at 20 ms and caps at 200 ms. The production critical section includes
file and directory synchronization. Scheduling and filesystem delays are
plausible contributors, but no captured lock timing establishes which caused
the earlier failure. This is an inference, not a root-cause finding.

The Linux comparison matches the prior Node/pnpm versions, but does not
establish identical architecture, kernel, CPU quota, filesystem or competing
load to the original cloud runner. All fresh full-suite outcomes were green;
there is no paired failing capture from that original environment. Consequently
the remaining acceptance gap is **unexplained intermittent lock timeout**.
Keep merge on hold until a bounded original-environment comparison/instrumented
capture explains it, or a maintainer explicitly accepts the documented known
failure separately from #358's cleanup fix. Do not weaken production limits or
keep running full suites until they pass.

## Artifact integrity

[manifest.json](manifest.json) records original and published SHA-256 values.
Public copies remove ANSI color codes, local user/temporary-root prefixes and
trailing whitespace;
test messages, failures, counts and exit codes remain. Preparation-command
hashes in result JSON may refer to raw setup logs retained in the isolated
test directory; the published manifest lists exactly the files provided here.
