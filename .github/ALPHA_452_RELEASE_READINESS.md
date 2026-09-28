# Alpha 4.52 product release readiness — 2026-09-28

## Authorized scope

Promote standalone PR #284: optional local request evidence, offline report CLI, minimal runtime integration and self-contained English/Chinese operational documentation. No internal evaluation runner/tasks/private archives, new model call, telemetry upload, statistics UI, Task activation or daily-service deployment. Defaults remain off. `latest` promotion is not part of this release.

## Exact candidate evidence

Base main: `42303bc817b27caa479f1e46e9af303abdbea4d2`. Product/preparation head: `640d18aad3f872047e1ea7ec58d1c6beb055d004`; subsequent catalog/tests/readiness changes do not modify runtime or packed files. Fresh independent ephemeral GPT-6 Astra static review passed with no blocker. Its input/report hashes, reviewed files and limitations are in [the review record](reviews/metrics-alpha452-20260928.json). No reviewer tools were used; this is separate from executed validation.

- Frozen dependency installation passed.
- Full check: 132 files / 1,533 tests passed, including types, lint, CLI, compatibility, build and package checks.
- Chromium: 13 files / 73 tests passed.
- Final frozen same-artifact matrix: stock DSH rc.1 and rc.2 passed; 460 scoped files remained byte-identical throughout. SHA-256: `5cab311ed632fb2156188a13633d0bf5ca4c569dad8415da4c95ad4d5063e4a4`.
- Both installed profiles exercised startup metrics opt-in, two synthetic dispatches, preserved unknown usage and the installed offline CLI; existing image/native-compaction/disposal regressions passed. No real provider acceptance requests.
- Dry package audit: both operational guides included; no evaluation tree, private journals or local machine paths introduced.

The initial full check failed because the operational-reference bilingual hash record had not been refreshed; it was corrected without changing assertions or runtime. A matrix run was stopped while a documentation-only candidate note was still being finalized; no pass was claimed from that run. The final matrix ran on frozen files and passed. Historical draft and earlier test evidence remain unchanged.

## Publication boundary

The verified catalog entry is added only after the above exact-version checks. Candidate metadata is not proof of npm publication. Merge requires the final PR-head checks; publication requires successful exact-main CI and the protected OIDC workflow. Preserve original failed runs if recovery is needed and never republish an existing npm version. After independent registry/tag/archive verification, update public recommendations through a separate documentation PR. No cost savings, complete task-accounting, Windows ACL audit, or physical connection limit is claimed.
