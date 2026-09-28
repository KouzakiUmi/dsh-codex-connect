# Local request metrics

English | [中文](request-metrics.zh.md)

This source adds opt-in, local-only HTTP-attempt evidence and a boot-free report command. It does not enable task orchestration, change model requests, call a model for measurement, or convert API prices to subscription quota. Introduced in the published Alpha 4.52 release; Alpha 4.51 and earlier packages do not contain this feature.

The internal evaluation program is not part of the installed package. This feature supplies evidence for diagnostics and separately designed comparisons; it is not a task-quality evaluator, a user-facing metrics panel or a proven efficiency improvement.

## Enable in an isolated profile

Add these fields to the existing `llm-openai-codex` plugin's `config` in the intended profile, then restart that profile through its normal lifecycle. Do not add a second copy of the plugin. These are startup configuration fields, not fields in the browser settings card.

```yaml
requestMetricsDirectory: /absolute/private/path/codex-request-metrics
requestMetricsMaxBytes: 16777216
```

The byte limit must be an integer from `4096` to `67108864`; the default is `16777216` (16 MiB). Setting only this limit does not enable collection. Use the native absolute path syntax on each OS; for example, a Windows YAML single-quoted value may be `'C:\Private\CodexMetrics'`. Configure access so only the intended account can read the directory.

Omitting `requestMetricsDirectory` disables recording. The directory must be absolute and, on POSIX, owner-only; a new directory is created with mode `0700`. Each process creates its own exclusive `requests-<uuid>.jsonl` with mode `0600`. Windows uses the directory's inherited ACL, which the plugin does not validate or change. Choose a private, nonsynchronized directory. Removing the configuration and restarting stops new collection without deleting evidence.

The size limit applies to one process journal, not the entire directory. Reaching the limit or encountering a write failure stops recording, warns once, and attempts to retain a stop marker; model execution continues. Crashes, disk failures and recordings disabled between processes can leave incomplete evidence. Retention and deletion are manual: no files are automatically removed.

## Read without network or credentials

```sh
dsh plugin --profile web exec dsh-codex-connect metrics --file /absolute/private/path/codex-request-metrics/requests-UUID.jsonl --json
```

Repeat `--file` to combine explicitly selected journals across restarts. Repeat `--session <DSH-session-id>` to select known sessions, including any children you explicitly want to include. Without a session filter, unattributed auxiliary traffic is included. The standalone equivalent is `node lib/bin.js metrics --file <journal> --json`; omitting `--json` prints a human-readable summary. The command reads only the named journal files, never credentials, and makes no network requests. Duplicate inputs, conflicting records and invalid schemas fail instead of silently doubling or dropping spend. A partial final line is disclosed and excluded. The version 1 journal format requires one collection-start header per file; request records before that header or after a closed/stopped marker, cross-file request pairing, non-string enum fields and impossible terminal-state changes are rejected. These checks do not make a journal an authenticated proof of task completion.

## What the numbers mean

Every admitted backend HTTP dispatch receives a start record immediately before fetch. A finish record reports response consumption, cancellation or transport failure, not merely header arrival. An observed terminal provider result takes precedence over subsequent reader cancellation or transport cleanup; cancellation before a terminal result remains cancellation. A start without a finish is pending or interrupted, never a successful zero-token request. Stream bytes, headers, retry policy, admission, cancellation and provider identity remain unchanged.

Adapter calls carry an independent call id, a SHA-256 session grouping key, selected model/effort and conversation/compaction/session-title purpose. Multiple HTTP attempts in the same adapter call are reported as additional attempts within that call. Tool-level or task-level retries across calls are not inferred. Standalone search, images, quota and Auto-review are counted by governor lane; they remain unattributed when no adapter scope exists. This is not a complete task ledger, a parent-child graph, user-turn counting or a task-quality result.

Usage is observed directly from bounded Responses terminal SSE events or JSON usage, before provider libraries can default missing counters to zero. Reports retain observed subtotals and unknown-attempt counts for input, cached input, cache writes, output and reasoning output. Responses input includes cached input; reasoning is a subset of output and is never added again. Missing, invalid and internally inconsistent fields remain unknown. Unsupported payload formats or oversized terminal frames can therefore produce unknown usage even when the provider library displays a value.

Cache hit ratio is the sum of cached input divided by the sum of input for attempts that report both, with the excluded-attempt count alongside it. It is not the average of request percentages. Latency covers HTTP dispatch through body completion; it excludes admission/authentication wait, and summed concurrent durations are not task wall-clock time.

Neither API dollar cost nor subscription quota cost is calculated. No unknown price or missing usage is treated as free. Reports exclude other providers, OAuth, public image downloads, pre-dispatch failures and past requests before collection. A completed provider response does not imply an accepted task. Even a cleanly closed journal cannot prove that every request in a task was observed.

Only allowlisted numerical/status metadata and bounded model identifiers are written. No request bodies, response content, tool arguments, system prompts, headers, credential values, account ids or server response ids are retained. Session hashes support correlation, not anonymization; treat journals as private operational data.

The Codex streaming caller explicitly declares SSE for successful responses whose media type is absent. This observation hint does not modify the response, override an explicit media type or apply to error responses. Other callers without a protocol hint retain unknown usage for unsupported or missing media types.

## Troubleshooting and stopping collection

If no journal appears, check that the directory is configured on the intended profile and that the profile restarted. On POSIX, the existing directory must be private (no group/other permission bits), writable, and a real directory rather than a symlink. A fixed warning means recording stopped; it does not mean the model request failed. Correct the path/permissions or disk condition before restarting. Do not share private journals publicly.

A `stoppedEarly` value or partial tail means the evidence is incomplete. Reaching the per-file limit does not rotate or delete files, and restarting creates another file; plan retention outside the plugin. To disable, remove `requestMetricsDirectory` from the effective startup config and restart the intended profile. Existing journals remain for explicit export or manual deletion.

If the report rejects a journal, use the original regular JSONL files from the configured directory. Do not splice multiple processes into one file or supply the same journal twice. Pass multiple files using repeated `--file` options. The command returns exit code 1 with a fixed, content-free error rather than printing private records. An unfinished final line is reported, not repaired.

## Validation limits

Automated tests use synthetic provider responses and verify configuration, observed values, cancellation, reporting and recovery. They do not prove current account availability, complete task cost, cache savings or server-side enforcement of client token limits. Any future real-account experiment needs its own bounded scope; installing or enabling the collector does not run an experiment or send an extra model request.

## Logical cancellation versus transport cleanup

This journal measures logical backend attempts, not the lifetime of every underlying socket or asynchronous cleanup operation. Existing governor behavior releases logical admission promptly after caller abort/disposal or a response-hook failure has requested body cancellation; it does not wait indefinitely for a custom transport's cancellation promise. An explicit consumer `body.cancel()` normally awaits source cleanup, unless a caller abort terminates the logical attempt first. The metrics observer does not change that abort policy.

A pending read resolved by consumer cancellation is not a successful EOF: without a previously observed terminal event, it must be recorded once as cancelled. An observed provider terminal remains authoritative even if its reader is cancelled during cleanup. Cancellation never refunds a research request reservation or proves that server-side work/billing has ceased. Concurrency limits apply to admitted logical requests, not a hard upper bound on sockets still cleaning up after cancellation. Strengthening physical cleanup policy would be a separate governor change with its own timeout/availability design.
