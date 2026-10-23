# Full repository review — 2026-10-21

Review-only record. This file changes no product source, generated bundle, lockfile, workflow or default. It lists findings and proposed dispositions; each proposal needs its own scoped change and maintainer decision. Nothing here reopens frozen tracks from [the maintenance scope](../../docs/maintenance-scope.md).

## Closeout snapshot — 2026-10-23

Read back against `main` **`3fb43cfcec417c96bdf67512dd775197062d82e2`**. This section supersedes the dated outcome/status statements below; the original findings, failed runs and review limits remain historical evidence. Updating this report does not implement any remaining proposal or reopen a frozen track.

| Item | Current disposition | Evidence and limits |
| --- | --- | --- |
| F1 Auto-review gates | **Merged and included in Alpha 10 source.** #382 (`8f22504`) is an ancestor of release commit `ab491482a8d9a44d1f5b6bc2b81229459d7ea2f5`. | The default-off gate hardening is released; this does not establish real-account or Desktop acceptance, or accept #327's keyring migration. |
| F2 dev-dependency advisories | **Source fixes merged**, #377 (`44652a5`) and #385 (`354846c`), and retained in the Alpha 10 source. | These are dev/test dependencies, not installed runtime payloads. The earlier audit results below remain dated; no fresh `pnpm audit` or authenticated Dependabot-alert-state readback was performed for this documentation closeout. No alert was dismissed. |
| F3 CodeQL alert 32 | **Unresolved; no fix or dismissal.** | `scripts/bounded-command.mjs` is byte-identical to the prior report head `bc67c06`. The last recorded alert state is open; current Security-tab state was not independently reread. Successful CodeQL check-runs do **not** establish that alert 32 disappeared. |
| F4 npm artifact | **Packaging fix merged and released.** #383 (`2e727ab`) excludes `docs/agent-notes`, `docs/experiments` and `docs/reviews`, with a pack guard. | Alpha 10 has 71 archive entries, zero internal evidence entries. #375's later 119-file evidence archive is excluded; its integration pack remains byte-identical to main's 71-file documentation archive. This `.github/reviews` report is also outside the package. |
| F5 loopback/proxy documentation | **Unresolved, unchanged.** | Current installation guidance describes `trust-origin`, but the explicit warning about a local reverse proxy rewriting `Host` to loopback remains unimplemented. |
| F6 writer-lock queue / #376 | **Unresolved, unchanged.** #376 remains Open. | No production queue was added and the historical cloud timeout remains unattributed. The controlled contention evidence and all six timeouts remain in the archive. Test cleanup in #358 is a separate change, not a lock fix. |
| #375 evidence archive | **Merged**, `3fb43cfcec417c96bdf67512dd775197062d82e2`. | [Exact-head CI 39974912236](https://github.com/franksong2702/dsh-codex-connect/actions/runs/39974912236), attempt 1: 10/10 successful checks on `389c8637683a9b97dad037fc8f386125514164df`, plus limited independent static review. All 119 archived blobs remain unchanged from `aa3b57d`. Post-merge [main CI 39977953190](https://github.com/franksong2702/dsh-codex-connect/actions/runs/39977953190) was still running at this snapshot; no success is inferred from the PR checks. |
| #380 compact speed menu / #378 | **Merged and released**, `3e71ee306e1bf6131d69d38ee53049717cb18147`; #378 is Closed. | Independently reviewed head `8b3c50d24341bdfae4616ddbb43d8a56ea524d80` fixed the observed expanded-text clipping. [Main CI 39877918360](https://github.com/franksong2702/dsh-codex-connect/actions/runs/39877918360) passed all eight checks; browser regression suite 97/97. Real Desktop/iPhone acceptance remains unperformed. |
| #358 test cleanup drain | **Still Draft** at `eec7c892f5dfba21009bcaa71db8f626cbbfa9df` at this snapshot. | The maintainer approved sequential, test-only closeout separately from #376; synchronization, exact-head verification and a fresh independent review are still required. The old COMMENTED recommendation is not GitHub APPROVED. No production-lock change or weakened deadline/concurrency/assertion is admitted. |
| #327 keyring storage | **Still Draft**, unchanged head `2482e590be24340e239e388857076a486a047b68`; now behind current main. | The scoped native evidence and all unaccepted platform/locked-operation rows remain. Neither this report nor Alpha 10 accepts or ships the keyring candidate. |
| #65 native compaction observations | **Still Open.** | Oversized-user retention/recall and checkpoint-only retries remain distinct unresolved observations. No new experiment or broader replay study was performed. |

### Release and CI identity

[Alpha 10](https://github.com/franksong2702/dsh-codex-connect/releases/tag/v0.2.0-alpha.10) is a **prerelease**, tag target `ab491482a8d9a44d1f5b6bc2b81229459d7ea2f5`. Git ancestry verifies that the F1/F2/F4, #386 registry-retry and #380 merges above are included. Public npm readback at **2026-10-23 15:26 UTC** confirms version `0.2.0-alpha.10` and both `latest`/`alpha` tags pointing to it. Moving `latest` was a separately authorized tag operation, not a stable release or a package republish.

The original [publish run 39941532769](https://github.com/franksong2702/dsh-codex-connect/actions/runs/39941532769) published npm successfully, then failed its bounded readback while the registry still returned stale/absent data. It was not rerun. [Protected recovery 39942737043](https://github.com/franksong2702/dsh-codex-connect/actions/runs/39942737043) verified the existing package and created the missing Git tag/prerelease with `npmRepublished=false` and `tagsPromoted=false`. Published archive SHA-256: `2650a9a0ebf91a700dc9f44b1532c5fd8e9b8b907456a9c3a931031ceb25f0a1`; public metadata still has SHA-1 `43be942d31e146665ca00afe57653166d600b1ce` and no npm `gitHead`. The later documentation-source archive hash `781a43dc9f680bffb1acfa5f0490fcd9641886a325c6ef87d29ac8f6e27c6f2e` is a different, unpublished artifact.

Historical main [CI 39804936511](https://github.com/franksong2702/dsh-codex-connect/actions/runs/39804936511) retains a Windows dependency-install failure with insufficient evidence to attribute its cause. Later green runs do not explain it; no blind rerun or diagnostic-workflow change is included here. The #380 approval-required first attempt had no jobs; its later approved execution was not a rerun of failed tests. The earlier #327/#381/#386 registry failures and reruns below also remain recorded.

This closeout changes only this report, synchronizes main by a normal merge, and relies on fresh bounded document/package checks plus exact-head required CI and independent review recorded on #381. No current Security-tab alert-state access, comprehensive new security audit, live OAuth/model request, installed Desktop/iPhone acceptance, daily installation/restart, package publication or npm-tag change is performed by this documentation update. No acceptance is inferred from historical evidence or synthetic Host checks.

## Historical outcomes — 2026-10-22

The findings below are the original 2026-10-21 review text. This section records what was actually done afterwards, with maintainer authorization for each merge. "Merged" means on `main`, **not released**: no npm version was published, so installed users get none of these changes until the next release. No security alert was dismissed and no repository setting was changed.

| Item | Outcome | Evidence |
| --- | --- | --- |
| F1 Auto-review gates | **Merged** as #382 → `8f225049da02067dea1c07646b03bff7b8fbc1e2`. #327's Auto-review source, tests and docs taken byte-identical; `lib/` rebuilt. Not released. | Local `pnpm run check`: 2,300 passed / 2 skipped. A negative control with main's old `auto-review.ts` failed the new gate tests. CI 10/10 on the head that merged, `6b032f3` (main merged in). |
| F2 dev-dependency advisories | **Merged** #377 → `44652a556682f31ca5529476315611320afcfa83` (vite 8.2.1 → 8.3.4, lockfile only). After it, `pnpm audit` on `main` `2e727ab` (and GitHub's push notice) reported **2 new moderate advisories** on dev-only `@vitest/mocker` 4.1.11: GHSA-qxg6-89mg-rqv8 and GHSA-xp26-3454-mjgp. **Merged** #385 → `354846c50478af1874222a67192e93e78d074558` (`vitest` and `@vitest/browser-playwright` 4.1.11 → 4.1.12; `package.json` two specs plus regenerated lockfile). Not released; the published artifact is unaffected either way. | #377: required checks green on `d2b6c7e`. #385: CI 10/10 on `22067da`. Local `pnpm run check` 2,300 passed; Chromium suite 14 files / 87 passed, run with a temporary executable-path-only config because of a container browser-build mismatch. `pnpm audit` on `main` `354846c`: "No known vulnerabilities found". Dependabot alert states were not read back through the GitHub API in this session. |
| F3 CodeQL alert 32 | **Open, no change.** Neither the code change nor a dismissal was authorized. | — |
| F4 npm artifact | **Merged** as #383 → `2e727abaa4e929a94f4db8b62abeeeae4ffb229d`. Excludes `docs/agent-notes`, `docs/experiments`, `docs/reviews`; `check-pack.mjs` now fails if any is packed. Not released. | Pack: 177 → 68 entries (3,712,997 → 2,846,347 unpacked bytes). The negative control without the exclusions failed with exit 1. CI 10/10 on `ed22270`. |
| F5 loopback/proxy docs | **Open, no change.** | — |
| F6 writer-lock queue | **Open, no change.** It still needs separately reviewed evidence (#376). | — |
| #327 keyring storage | **Updated, still draft.** `main` merged in with a normal merge commit (`a297fa6` → `2482e59`), no rebase/force. The Auto-review files now match `main`; the remaining diff is the keyring change only (49 files). | Local `pnpm run check` on `2482e59`: 2,318 passed / 2 skipped. CI: first run 9/10. `validate (22.19.0)` failed in `check-adaptive-task-matrix.mjs` on `TypeError: fetch failed` (npm registry request) after all tests had passed. Its single rerun passed at 2026-10-22 01:03 UTC, so CI is **10/10** on `2482e59`. The branch is now `behind` `main` by #383 (packaging only); it was not updated again. |
| CI registry resilience (found during follow-up) | **Merged** #386 → `1c6b0e7235d238e1bbd0b6c74b807736a5129160`. `readDshRegistryManifest` retries network errors, timeouts and 408/429/5xx up to 3 attempts (1 s / 2 s backoff); other statuses still fail at once. Added after `validate` jobs on #327 and #381 failed only on npm registry reads. | Local `pnpm run check` 2,303 passed. The 3 new tests failed against the old reader. #386's first CI run failed in all 4 core jobs on a sustained runner→registry outage (6 attempts over ~4.6 min still failed); retries do not fix such outages. Its single rerun at 04:03 UTC passed 10/10. |
| #375, #380, #358 | **Unchanged.** #375 can now merge without its evidence shipping to npm. #380 still has no CI (fork workflow approval needed). #358 remains on hold per #376. | — |

## Historical identity and executed checks

- Source: `main` at `e5579b71339ba932dec7dfba497fc97df8fbf124`, version `0.2.0-alpha.9`.
- Runtime: Linux x64 cloud container, Node 22.22.0, pnpm 10.30.3. Synthetic fixtures only; no live account, model call, real credential, installed Host or service was used.
- `pnpm --config.minimum-release-age=0 install --frozen-lockfile`: exit 0.
- `pnpm run lint`: exit 0. `pnpm run typecheck`: exit 0.
- `pnpm run test`: exit 0, **169 files, 2,257 passed, 2 skipped**. The #376 writer-lock timeout did not occur in this single run. That does not count as evidence either way.
- `pnpm audit`: **3 advisories (1 high, 2 moderate)**, all on `vite@8.2.1` (details below).
- `npm pack --dry-run --json`: 177 entries, 1,661,858 bytes packed / 3,695,100 unpacked. 158 of the entries are under `docs/` (2.1 MB).
- GitHub state read on 2026-10-21: 3 open issues (#378, #376, #65) and 5 open PRs (#380, #377, #375, #358, #327). Without an authenticated security API, the code-scanning alert was identified from the readback saved in #375 (`docs/reviews/2026-10-20-maintenance/pr327-installed-native/github-readback.json`). The maintainer should still confirm the exact alert location on the Security tab.

## 中文摘要 — historical 2026-10-22 snapshot

"已合并"指已进入 `main`，**尚未发布**到 npm。

| # | 优先级 | 问题 | 建议 | 实际处理（2026-10-22） |
| --- | --- | --- | --- | --- |
| F1 | 高（默认关闭的功能） | `main` 上 Auto-review 只要远端模型返回 `allow` 就直接 `allowed-once`，即使模型自己评为 `high`/`critical`；也没有本地敏感目标（如 `.openai-codex-auth.json`）检查 | 把 #327 中与密钥存储无关的审批门禁加固拆成独立小 PR 先合入 | 已合并 #382（`8f22504`） |
| F2 | 中（仅开发依赖） | Security 页的 3 个漏洞：`vite@8.2.1`（launch-editor 相关 GHSA，1 high + 2 moderate），仅测试/浏览器测试链使用，不进入发布包 | 合并 Dependabot #377（升级到 8.3.4，必需检查已通过） | 已合并 #377（`44652a5`）修复 vite 告警；随后出现的 2 个 `@vitest/mocker` moderate 告警由 #385（`354846c`，升级到 4.1.12）修复；`main` 上 `pnpm audit` 已无告警 |
| F3 | 中（CodeQL） | 告警 32 `js/shell-command-injection-from-environment`：`scripts/bounded-command.mjs` 在 Windows 上把来自环境（`ComSpec`、`tmpdir()` 推导的路径）的值拼接成 `cmd /d /s /c` 命令行 | 仅限 CI/开发脚本，不随包发布。建议改为直接用 `process.execPath` 运行 JS 入口，避免经过 `cmd`；若暂不改代码，以 "used in tests" 理由附证据关闭 | 未处理，告警仍开放 |
| F4 | 中 | `package.json` 的 `files` 包含整个 `docs/`，发布包含 109 个 experiments/agent-notes 内部文件；#375 若合并，会再把 `docs/reviews/` 证据（约 3.5 万行）带进 npm 包 | 改为显式白名单，或排除 `docs/experiments`、`docs/agent-notes`、`docs/reviews`，并在 `check-pack.mjs` 中断言 | 已合并 #383（`2e727ab`），包内文件 177 → 68 |
| F5 | 低（文档） | 回环信任：本机 peer + 回环 Host 即视为可信；若用户在本机放反向代理（如 Tailscale Serve/nginx 转发 `Host: localhost`），远端浏览器会继承信任（仍需 Host 自身认证） | 在 SECURITY/INSTALL 中写明不要以回环 Host 头反代 | 未处理 |
| F6 | 维护 | #376 锁超时机制：释放锁不唤醒等待者，固定退避造成空档 | 在插件内对同一文件加进程内异步队列，再获取文件锁；跨进程语义不变。属于生产改动，需单独评审 | 未处理 |
| F7 | 流程 | #380 来自 fork，无任何 check run；#358/#327/#375 为 draft 且各自等待独立决定 | 见下方 PR 处置表 | #327 已合并 main，现仅含 keyring 改动，CI 10/10（一次 registry 网络失败重跑后通过），仍为 draft；其余未变 |

## Findings — original 2026-10-21 review

### F1 — Auto-review allows on the remote verdict alone (main)

`src/auto-review.ts:72-75` on main:

```ts
const denied = result.assessment.outcome === 'deny'
...
if (!denied) return 'allowed-once'
```

The model's own `risk_level` and `user_authorization` are logged and then ignored. Today an assessment of `{ outcome: 'allow', risk_level: 'critical', user_authorization: 'unknown' }` auto-approves the action. The prompt tells the model to deny critical actions, but a prompt is not an authorization boundary (see AGENTS.md: "Prompts cannot grant authority"). The reviewer also reads transcript content that may contain prompt injection. On main there is also no local sensitive-target check: a read of `.openai-codex-auth.json` or its `.v1-backup` inside the workspace goes to the remote reviewer, and its `allow` is final. #327's body records the same gap. Its negative control showed two synthetic reads returning `allowed-once`.

Exposure is limited: Auto-review is off by default (`enableAutoReview: false`, disclosure acknowledgement required), and Host execution-time permissions still apply. It is still a published feature, and the fix already exists.

**Proposal.** Split #327's approval-gate changes (`src/auto-review.ts`, `src/auto-review-contract.ts`, `src/auto-review-backend.ts`, their tests) into a separate small PR. They don't depend on keyring storage. They include:
- a local risk floor (no automatic allow for `high`/`critical`, or for `unknown` authorization);
- sensitive-target delegation to human approval before contacting the reviewer;
- revalidation after the remote verdict;
- cancellation checks.

Merge that first. The keyring migration stays in draft #327 until native acceptance gaps close. Minimum regression: an injected backend returning `allow` + `critical` must end in `next()`, and so must `allow` for a read of the credential file.

### F2 — Dependabot: vite 8.2.1 (3 advisories)

`pnpm audit` reports GHSA-587h-7wmj-h5pm (high), GHSA-698v-4r3x-3vcv (moderate) and GHSA-r825-w8mm-5pxw (moderate). All three are in `launch-editor` via `vite >=8.2.0 <=8.2.3` (Windows command handling), and all are patched in `>=8.2.4`. The only path is `@vitest/browser-playwright > @vitest/mocker > vite`, so vite is a dev/test dependency only. `lib/` and the packed artifact don't contain it, and installed users are unaffected. The 2026-10-20 readback in #375 had zero open Dependabot entries, so these advisories are newer.

**Proposal.** Merge #377 (`vite 8.2.1 → 8.3.4`). Lockfile-only change, one vite version in the tree after it. All six CI jobs and dependency-review passed on its head. CodeQL is `neutral`, which is expected for a lockfile-only diff.

### F3 — CodeQL alert 32, `js/shell-command-injection-from-environment` (medium)

`scripts/bounded-command.mjs:26-38` builds a `cmd.exe /d /s /c "<command> <args>"` line on Windows for `.cmd`/`.bat` targets. The executable is `process.env.ComSpec`, and callers pass paths derived from the environment. For example, `scripts/check-dsh-install.mjs:197,260` runs `<tmpdir()>/…/node_modules/.bin/dsh.cmd`, where `tmpdir()` comes from `TEMP`/`TMP`. That env-to-shell flow is what this rule reports. The escaping mirrors `cross-spawn`'s, and these scripts run only in CI/development. `scripts/` is excluded from the package and `check-pack.mjs` forbids it.

**Proposal**, choose one:
1. **Preferred (removes the class):** for npm/pnpm/dsh, resolve the package's JS entry (`npm-cli.js`, the `dsh` package `bin` from its `package.json`) and spawn `process.execPath` with it directly. That avoids `cmd.exe`, so `resolveCommandInvocation` is no longer needed for those callers. Keep `check-dsh-next-contract.mjs` covering any remaining `.cmd` path.
2. **If no code change is wanted now:** dismiss as "Used in tests" with a comment linking this record. CI-only scope, no network-controlled input, escaping equivalent to cross-spawn. That needs explicit maintainer authorization, as alert 31 had.

### F4 — npm artifact ships internal evidence

`package.json:80` lists `"docs"` with a single exclusion. The current tarball already contains 109 files under `docs/experiments` and `docs/agent-notes`: archived research, handoffs and acceptance plans, frozen per the maintenance scope. #375 adds `docs/reviews/2026-10-2x-maintenance/**`, including sanitized logs and GitHub readbacks. If it merges unchanged, that material would be published to npm as well. `check-pack.mjs` has no assertion against it.

**Proposal.** Switch `files` to an explicit list of user-facing docs: `docs/README.zh.md`, `docs/reference*.md`, `docs/auto-review*.md`, `docs/preflight-activity*.md`, `docs/request-metrics*.md`, `docs/runtime-identity.md`, `docs/VERSIONING.zh.md`, `docs/licenses/**`, `docs/assets/**` (if referenced), `docs/release-notes/**` (if referenced). Alternatively add `!docs/experiments`, `!docs/agent-notes`, `!docs/reviews`. Add a forbidden-path assertion in `check-pack.mjs`, check that README/INSTALL links resolve to packed files or to GitHub URLs, and regenerate any reference hashes. Do this before or together with merging #375.

### F5 — Loopback trust behind a local reverse proxy (documentation)

`src/auth-routes.ts:469` trusts any request whose socket peer is loopback and whose `Host` is loopback. Host-owned authentication (`harnessHttpRejection`) runs first, and cross-site/Origin checks still apply, so this isn't a bypass on its own. But a same-machine reverse proxy that forwards with `Host: localhost` makes every proxied client look local to the OAuth routes.

**Proposal.** Documentation only: SECURITY.md/INSTALL.md should say that remote access must go through `trust-origin` with the real external origin, and that a proxy must not rewrite `Host` to loopback. No code change proposed.

### F6 — #376 writer-lock contention mechanism

#375's diagnostics show synchronized fixed backoff (20→40→80→160→200 ms) with no wake-up on release: about 0.13 s of total lock hold against about 1.59 s of gaps for 12 writers. All 12 contenders in the failing test are in one process. The plugin could serialize same-file updates in-process (a promise chain keyed by the resolved filename) before calling `withFileLock`. Intra-process contenders would then never poll the file lock, while cross-process exclusion stays with `@deepseek-ai/dsh-atomic-write`. The same helper would apply to `store.ts`, `trusted-origins.ts` and `adaptive-task-store.ts`.

This is a production change and lies outside #376's "no production change without separate evidence" rule. It is a candidate for a separately reviewed PR, not an attribution of the historical cloud failure. Deadlines, concurrency and the test's assertions stay unchanged.

### Reviewed without findings

- `src/public-http.ts` (remote image SSRF guard): resolves and rejects non-public addresses, pins the socket lookup per hop, revalidates each redirect, bounds bytes and time. IPv4-mapped, NAT64, Teredo and 6to4 addresses fall outside the allowed global range. One note: an `https → http` redirect is allowed, which is consistent with accepting `http:` sources at all.
- `src/settings-contract.ts` proxy URL: rejects credentials, paths and non-HTTP(S) schemes.
- `src/trusted-origins.ts`, `src/store.ts`: owner-only mode checks, strict schema, no secret echo in errors, atomic locked writes. Plaintext-at-rest is the known gap addressed by #327.
- `src/image-asset-routes.ts` / `image-assets-contract.ts`: id and filename patterns prevent traversal and header injection; `nosniff` + `attachment`.
- `src/bin.ts` browser opener: HTTPS only, argument vector without a shell.
- `src/client/OpenAICodexUpdateNotice.tsx`: no `dangerouslySetInnerHTML`; links restricted to `https:`.
- Workflows: every third-party action pinned to a full SHA; `permissions: contents: read` by default; write scopes only in release/canary jobs; no `pull_request_target`.

## Open PR dispositions — historical proposals

| PR | State read (2026-10-21) | Proposal | Outcome (2026-10-22) |
| --- | --- | --- | --- |
| #377 vite 8.3.4 | Ready, required checks green | Merge (fixes F2). | Merged `44652a5`. Follow-up #385 (vitest 4.1.12) merged `354846c`. |
| #380 speed menu (fork, closes #378) | Not draft, `blocked`, **zero check runs** on `46cd71a` | Approve the fork workflow run so CI produces exact-head evidence, then review. It's a UI-only change in an "existing maintenance only" surface (no new persisted setting), so a maintainer scope decision is required before merge. | Unchanged; awaiting workflow approval and the scope decision. |
| #327 keyring storage + approval gates | Draft, 10/10 checks green, independent review COMMENTED | Split the approval-gate part out (F1) and merge it first. Keep keyring migration draft until the listed native gaps are covered or explicitly accepted. | Gates split out and merged as #382. `main` merged into #327 (`2482e59`). Keyring-only diff, still draft. CI as in Outcomes. |
| #358 test cleanup drain | Draft, hold per #376 | Test-only and correct on its own (it stops cleanup racing live writers). Consider recording the acceptance decision in #376 separately from the root cause, so the test's ENOTEMPTY masking is fixed even while the timeout stays unattributed. | Unchanged. |
| #375 evidence docs | Draft, 35,695 additions | Resolve F4 before merging, or move the evidence under `.github/reviews/` (not packed). | Unchanged. The F4 precondition is met by #383. |

## Open issues — historical snapshot

- **#378**: addressed by #380's proposal. Needs a scope decision (hide vs. compact menu).
- **#376**: F6 offers a candidate mechanism fix. The open attribution checklist items are unchanged.
- **#65**: no new evidence from this review. The two maintenance items remain open.

## Original review limits

This is a static, single-pass review plus one local run of the checks named above. It didn't cover the frozen Adaptive Task modules in depth, native compaction replay correctness, the browser suite (`pnpm run test:browser`), the DSH install matrix, Windows, or any installed/running Host. The review itself changed no GitHub setting, alert, PR or issue. The follow-up merges, the #327 branch update, its comments and the one CI rerun listed under Outcomes were separately authorized by the maintainer. None of them was a release, a live-account or Host acceptance, or an alert dismissal.
