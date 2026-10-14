# 0.2.0-alpha.4 exact-host compatibility readiness

Checked 2026-10-14. **Verification is not publication.** Public installation recommendations remain on the published alpha.3 pair until protected publication and npm/tag readback finish.

## Verified candidate

- Implementation and fixture head: `1e8a1c58212b46100da98b4bcd827853f005c592`.
- [Complete CI evidence](https://github.com/franksong2702/dsh-codex-connect/actions/runs/38598721275): all six CI jobs succeeded; all ten PR checks succeeded at this head.
- Canonical npm archive SHA-256: `d4c2ab9d2305b75fd5c53d97eb70bf532dcd78a0a95529ce1e0c721f591b27b9`.
- All fourteen installation/runtime reports (seven hosts on Node 22.19.0 and 24.21.0) carry this identical archive digest. A local npm 11.6.4 repack reproduces it, including Git's 0644 mode for the public release note. No payload bytes changed during permission reconciliation.
- Exact hosts: `0.1.7-rc.1`, `0.1.7-rc.2`, `0.2.0-rc.1`, `0.2.0-rc.2`, `0.2.1-alpha.1`, `0.2.1-alpha.2`, `0.2.1-alpha.3`. No inferred ranges or future-host admission.

## Corrections and acceptance

Sol implemented the corrections; parent review independently checked source contracts, changes, local gates and remote evidence.

1. Alpha.3 generic model listing eagerly resolves credentials. Codex projects its fixed metadata catalog without account capture or refresh; actual requests still require credentials. Missing credentials cause zero HTTP requests. All installed reports retain eleven models and actual request-metrics/CLI/startup-configuration assertions.
2. New settings snapshots omit legacy `mode`. Client projection preserves that absence and retains legacy memory rejection plus Host writability, revision, conflict and accepted-value authority. This is not a bypass for read-only or stale settings.
3. JSONL persistence changes from a default service class to a namespace plugin in alpha.3. Fixture-only selection preserves the entire plugin, including Config and ordered resource ownership, and rejects ambiguous exports. Original assertions and case membership are unchanged. Reproduction proved all prior 52 Phase2 failures came from the old bootstrap import.
4. The alpha.2 tools fixture uses native registration with scoped PTC presentation and cancellation-aware working-directory support, rather than retired `both` mode.

Local complete check: **141 files / 1,816 tests**, Chromium **12 files / 58 tests**, plus authenticated product control. Actual alpha.2 and alpha.3 focused SDK runs independently retain native lifecycle ten fresh processes, 138 Phase2 cases, 18 crash cases / 36 processes, eleven export-shape cases and four cold-persistence processes each.

Complete CI additionally retains all seven installed-host runtime contracts on both Nodes, including default/disposal boundaries, native compaction's five phases across two encodings / ten processes, synthetic image generation/editing/code paths and refusal/ownership checks. Both Phase2 CI jobs enforce unchanged exact-runtime, network, consent, authority and recovery assertions; all fourteen per-host logs confirm 138 tests and 18 crash cases / 36 processes. Detailed Phase2 JSON is not retained in the Actions log; this record does not claim otherwise. Phase1 model selection, browser controls, Windows contract, CodeQL and dependency review also passed.

## Boundaries and remaining release gates

- No real OAuth/provider dispatch, daily profile change, forced install, peer exemption or Desktop acceptance. New-host client review and browser fixtures do not constitute real Desktop acceptance.
- Optional/native capabilities and production Task defaults remain unchanged; no frozen feature was activated.
- This evidence/catalog-only follow-up does not alter packed files. Fresh exact-head PR CI, normal merge, exact-main CI and the protected Alpha-only publishing workflow remain required.
- Publish only the verified artifact; independently read back npm version/integrity, `alpha`, unchanged `latest`, the matching tag and prerelease. Update public recommendations only after that succeeds.

## 中文摘要

候选插件 `0.2.0-alpha.4` 已使用同一规范安装包，在两个 Node 版本上通过全部七个精确 DSH 版本的隔离回归，保留原五版本支持。模型目录鉴权、设置快照和持久化测试装配差异均已修正；未放宽实际请求鉴权、Host 配置权限、恢复断言或版本准入。

本记录及兼容目录仅证明候选验证，不代表 npm 已发布。后续仍须通过新提交及 main 的完整 CI、受保护的 Alpha 发布流程和发布身份读回。日常 profile、真实账号、真实模型调用及 Desktop 均未验收或更改；不会提升 `latest`。
