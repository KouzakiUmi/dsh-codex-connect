# Local request metrics (unreleased)

This source adds opt-in, local-only HTTP-attempt evidence and a boot-free report command. It does not enable task orchestration, change model requests, call a model for measurement, or convert API prices to subscription quota. The published Alpha 4.50 package does not contain this addition.

The [internal autonomy evaluation protocol](experiments/autonomy-evaluation.md) defines how this evidence may support future task-quality comparisons. Its current offline fixtures are not real agent trials, and no user-facing metrics panel or efficiency claim is included.

## Enable in an isolated profile

Add these fields to the existing `llm-openai-codex` plugin's `config` in the intended profile, then restart that profile through its normal lifecycle. Do not add a second copy of the plugin. These are startup configuration fields, not fields in the browser settings card.

```yaml
requestMetricsDirectory: /absolute/private/path/codex-request-metrics
requestMetricsMaxBytes: 16777216
```

Omitting `requestMetricsDirectory` disables recording. The directory must be absolute and, on POSIX, owner-only; a new directory is created with mode `0700`. Each process creates its own exclusive `requests-<uuid>.jsonl` with mode `0600`. Windows uses the directory's inherited ACL, which the plugin does not validate or change. Choose a private, nonsynchronized directory. Removing the configuration and restarting stops new collection without deleting evidence.

The size limit applies to one process journal, not the entire directory. Reaching the limit or encountering a write failure stops recording, warns once, and attempts to retain a stop marker; model execution continues. Crashes, disk failures and recordings disabled between processes can leave incomplete evidence. Retention and deletion are manual: no files are automatically removed.

## Read without network or credentials

```sh
dsh plugin --profile web exec dsh-codex-connect metrics --file /absolute/private/path/codex-request-metrics/requests-UUID.jsonl --json
```

Repeat `--file` to combine explicitly selected journals across restarts. Repeat `--session <DSH-session-id>` to select known sessions, including any children you explicitly want to include. Without a session filter, unattributed auxiliary traffic is included. The standalone equivalent is `node lib/bin.js metrics --file <journal> --json`; omitting `--json` prints a human-readable summary. The command reads only the named journal files, never credentials, and makes no network requests. Duplicate inputs, conflicting records and invalid schemas fail instead of silently doubling or dropping spend. A partial final line is disclosed and excluded. The unreleased journal format requires one collection-start header per file; request records before that header or after a closed/stopped marker, cross-file request pairing, non-string enum fields and impossible terminal-state changes are rejected. These checks do not make a journal an authenticated proof of task completion.

## What the numbers mean

Every admitted backend HTTP dispatch receives a start record immediately before fetch. A finish record reports response consumption, cancellation or transport failure, not merely header arrival. An observed terminal provider result takes precedence over subsequent reader cancellation or transport cleanup; cancellation before a terminal result remains cancellation. A start without a finish is pending or interrupted, never a successful zero-token request. Stream bytes, headers, retry policy, admission, cancellation and provider identity remain unchanged.

Adapter calls carry an independent call id, a SHA-256 session grouping key, selected model/effort and conversation/compaction/session-title purpose. Multiple HTTP attempts in the same adapter call are reported as additional attempts within that call. Tool-level or task-level retries across calls are not inferred. Standalone search, images, quota and Auto-review are counted by governor lane; they remain unattributed when no adapter scope exists. This is not a complete task ledger, a parent-child graph, user-turn counting or a task-quality result.

Usage is observed directly from bounded Responses terminal SSE events or JSON usage, before provider libraries can default missing counters to zero. Reports retain observed subtotals and unknown-attempt counts for input, cached input, cache writes, output and reasoning output. Responses input includes cached input; reasoning is a subset of output and is never added again. Missing, invalid and internally inconsistent fields remain unknown. Unsupported payload formats or oversized terminal frames can therefore produce unknown usage even when the provider library displays a value.

Cache hit ratio is the sum of cached input divided by the sum of input for attempts that report both, with the excluded-attempt count alongside it. It is not the average of request percentages. Latency covers HTTP dispatch through body completion; it excludes admission/authentication wait, and summed concurrent durations are not task wall-clock time.

Neither API dollar cost nor subscription quota cost is calculated. No unknown price or missing usage is treated as free. Reports exclude other providers, OAuth, public image downloads, pre-dispatch failures and past requests before collection. A completed provider response does not imply an accepted task. Even a cleanly closed journal cannot prove that every request in a task was observed.

Only allowlisted numerical/status metadata and bounded model identifiers are written. No request bodies, response content, tool arguments, system prompts, headers, credential values, account ids or server response ids are retained. Session hashes support correlation, not anonymization; treat journals as private operational data.

The Codex streaming caller explicitly declares SSE for successful responses whose media type is absent. This observation hint does not modify the response, override an explicit media type or apply to error responses. Other callers without a protocol hint retain unknown usage for unsupported or missing media types.

## Cache-baseline acceptance before dynamic effort

Use the actual installed adapter and provider serialization, not a hand-built HTTP approximation. Record exact plugin/host/provider versions separately, the selected model, a fixed synthetic task and explicit evaluation boundaries. First verify a warm repeated-prefix control has positive wire-reported cached input; zero or unknown means the baseline is not established. Only then compare effort updates, without simultaneously changing models, tool definitions, compaction policy or account. Record all journals, including failed attempts, and compare token-weighted ratios, observation coverage, output tokens and request durations. This collector does not yet send `configuration_update`.

Real-account calls require a separately bounded test budget and isolated profile. The keyless tests prove collection and aggregation, not cache availability, savings, effective server effort or subscription-quota behavior. Human task-quality acceptance and parent/child task attribution remain separate work.

For the first baseline, allow at most three Astra requests with a fixed synthetic prefix, session key and reasoning effort, no tools, no automatic retries and no model switching. Stop on authentication, quota or protocol errors. Check credential validity before dispatch; use a separate isolated login rather than refreshing a daily profile's credentials. Do not copy credential values into reports.

The inspected pi-ai `0.85.1` Codex serializer does not send `max_output_tokens`, even when the caller supplies `maxTokens`. A short-answer instruction or client cancellation deadline is not a hard server-side token or cost ceiling. Report this limitation before live sampling; an aborted request may still consume usage. The three-request limit is a request-count bound, not a currency or subscription-quota bound.

## Logical cancellation versus transport cleanup

This journal measures logical backend attempts, not the lifetime of every underlying socket or asynchronous cleanup operation. Existing governor behavior releases logical admission promptly after caller abort/disposal or a response-hook failure has requested body cancellation; it does not wait indefinitely for a custom transport's cancellation promise. An explicit consumer `body.cancel()` normally awaits source cleanup, unless a caller abort terminates the logical attempt first. The metrics observer does not change that abort policy.

A pending read resolved by consumer cancellation is not a successful EOF: without a previously observed terminal event, it must be recorded once as cancelled. An observed provider terminal remains authoritative even if its reader is cancelled during cleanup. Cancellation never refunds a research request reservation or proves that server-side work/billing has ceased. Concurrency limits apply to admitted logical requests, not a hard upper bound on sockets still cleaning up after cancellation. Strengthening physical cleanup policy would be a separate governor change with its own timeout/availability design.
