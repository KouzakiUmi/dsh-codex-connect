# Issue #65: bounded maintenance status — 2026-10-20

Issue: https://github.com/franksong2702/dsh-codex-connect/issues/65

This update supersedes the broad experiment/closeout plans in historical issue
comments. Only the two maintenance items below remain active. No live provider,
quota/context exhaustion, long-task matrix, savings study, or feature promotion
was performed or scheduled.

## 1. Oversized user-content retention and recall — OPEN

The exact main source inspected was
`e5579b71339ba932dec7dfba497fc97df8fbf124`.
The plugin's `retainedNativeCompactionInput` still uses a **64,000 serialized
UTF-8 byte** ceiling, not a tokenizer's 64,000-token budget. A user item that
does not fit is skipped in full.

A bounded, pure-function, credential-free probe on Node 22.22.3 confirmed:

| Fixture | Retained user items |
| --- | ---: |
| Small synthetic user message | 1 |
| Synthetic 65,059-byte user item | 0 |
| Both items | 1, the small item only |

[Machine-readable observation](issue-65-retention.json) includes the source hash.
This establishes the current retention projection. It does **not** establish
what an opaque provider checkpoint remembers or reproduce a semantic model
recall failure. There was no checkpoint creation, persistence/restart probe,
model request, credential access, or Host scheduler execution.

The historical failed acceptance remains `RECALL_MISMATCH_NO_RETRY`; later
A/B successes do not explain it retroactively. See the
[offline investigation](../../agent-notes/remember-recall-investigation-2026-09-18.md).
No plugin retention repair is claimed here. A future repair needs a bounded,
reviewable retention contract and regression evidence without discarding saved
checkpoint readability, fallback or recovery.

## 2. Checkpoint-only scheduler retries — OPEN

Historical evidence records the stock scheduler selecting the same checkpoint
again at 80,354 tokens against an 80,286 soft threshold. It rejected a larger
replacement but still made an unnecessary call.

| Delivery layer | Evidence and limit |
| --- | --- |
| Plugin | The plugin's retention/checkpoint codec is not the Host scheduler. This documentation update does not deliver a scheduler fix. |
| Local Host patch | Commit `2e5469e645bc8236ce4ff18b1a87093559f0af45` skipped checkpoint-only pressure ranges in the separately reported 3081 preview. That was a local Host patch. |
| Official Host release | No exact official release/artifact plus bounded runtime verification was established in this session. Compatibility declarations are not proof that this scheduler fix shipped. |

The current plugin source version is `0.2.0-alpha.9`; that is source identity,
not a new release or installation. Declared Host compatibility also does not
prove the behavior of a deployed profile. No daily Host installation, restart,
local patch application, or official release was performed.

## Completion criteria and preserved limits

Keep #65 open. Each item may advance only on its own bounded evidence:
oversized-content retention and semantic recall must remain distinct; local
Host patching and official Host delivery must remain distinct. Historical
uncompleted fork, transition, long-task quality and accounting matrices are
archived context, not current work. Do not close the issue merely to clear a
tracker or describe either observation as fixed without delivery evidence.
