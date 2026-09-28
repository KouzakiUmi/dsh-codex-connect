# Request metrics: standalone runtime candidate

## Scope

This candidate is based on maintenance main `2ac612385ea3c3fcfc1078dc18619d7b1dc49b9a`. It extracts only the opt-in metrics collector, offline reporting CLI, minimal adapter/backend integration and tests. It excludes the internal evaluation runner, task catalog, local project documents, private journals and machine paths. The unchanged package version identifies the base release, not publication of these new features.

Collection is disabled when no metrics directory is configured. It records bounded local operational metadata, preserves missing usage as unknown, and never calculates subscription cost or uploads telemetry. No UI, Task activation, account changes, real experiment or deployment is included. See [the measurement contract](../request-metrics.md).

## Review

An independent ephemeral GPT-6 Astra process reviewed the complete selected metrics/diagnostic/backend sources and integrations. Final static verdict: PASS, no findings. The exact reviewed file bytes match this extraction; see [the original report and fingerprints](../experiments/evidence/request-metrics-runtime-review-20260928.json). This does not certify unprovided dependencies or replace candidate installation tests.

Earlier review findings were reproduced and repaired: untrusted SSE type coercion, enum coercion, invalid journal lifecycle/pairing, diagnostic unread-reader error forwarding, and pending-read cancellation misclassification. The first diagnostic repairs are already isolated in the maintenance base. The candidate retains the original governor policy of prompt logical cancellation, not a new physical socket cleanup guarantee; that scope and the review disposition remain explicit.

## Remaining gate

Frozen install, full check, Chromium and the exact rc.1/rc.2 same-artifact installation matrix are required on this standalone tree. A draft PR makes this scope reviewable; it does not authorize merging the entire internal research archive or publishing metrics under the existing version. No efficiency, token-saving or autonomous-delegation benefit is claimed.

## Standalone verification completed

On the extracted candidate, frozen install and full check passed (131 files / 1,529 tests); Chromium passed (13 files / 73 tests). Both stock DSH rc.1 and rc.2 passed the same-artifact installed runtime checks with defaults unchanged. The tested archive SHA-256 is `43d87c178d16792d674ce3878dc8ab3b9f98541145a91aaae6e16fe61d6f1a9d`; it predates only the final evidence-note update and is not the published 4.51 archive. Existing image/compaction paths and the installed metrics checker were exercised with synthetic responses. No real experiment or account acceptance was run.

This remains a draft product candidate: no new release number is allocated, no `latest` tag changes, and no daily service installation. Final PR-head CI and review remain separate from the preserved local results.
