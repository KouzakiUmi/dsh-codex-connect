# Persistent model context tiers — 2026-10-13

## Defect and decision

The session expansion switch bound its budget to the ordinary turn's cancellation signal. Manual `/compact` creates a separate maintenance signal; the Host's `llm.stream()` calls `adapter.prepareCall()` rather than the adapter's direct `stream()` method. That unbound preparation chose 272K even after the switch was enabled. A focused regression reproduced an expected 500K window resolving to 272K without another ordinary turn. This establishes a local window mismatch, not every possible cause of a reported remote request stall.

The replacement is a per-model `modelContextTiers` setting in the existing Host-owned configuration form:

- `standard`: the plugin's ordinary window, currently 272K for known models.
- `extended`: 500K, bounded by the model's configuration maximum.
- `maximum`: the model's configuration maximum, currently 872K for expandable models.
- Missing or per-model `null`: Standard. Unknown model entries never manufacture a larger capacity.

Each Models row offers the finite supported choices. Edits remain staged until Save. The accepted map is consumed by one dynamic adapter profile for model resolution, pressure checks, prepared calls and compaction. New profile-map identity snapshots capture changed budgets; prepared requests retain their original generation. No global provider catalog is mutated, no session history is edited and no credentials are needed for metadata resolution. The Host remains responsible for admission, compression policy and settings persistence.

The Composer control is now a read-only saved-window indicator, not a toggle: gray Standard, blue Extended, amber Maximum. Hover and keyboard focus explain the capacity, where to change it, and the risks. Missing settings are unconfirmed rather than a false default. This is raw capacity, not token usage or account entitlement.

## Compatibility

Old `maximumContextModels` and arbitrary `contextWindowOverrides` remain accepted but inert; an ON-only preference is not silently converted into always-on expansion. Existing history is retained. For an old approximately 400K conversation, save an appropriate model tier before `/compact`; both new and existing conversations then resolve the same capacity without needing another ordinary request. Old browser calls to the retired session-toggle route receive an authenticated `410 MODEL_CONTEXT_TIERS_REQUIRED`, with no body read or fictitious successful state change.

The existing catalog ceilings and provenance are unchanged. Client metadata cannot grant a server capability. Expansion can increase quota use and errors, and remote rejection must remain an error rather than deleting history or silently replaying a mutation.

## Synthetic regression coverage

The tests use unmodified Host LLM, AgentLoop, meter, BasicCompactionEngine, maintenance ownership and isolated JSONL persistence with synthetic account/provider responses. A conversation with over 400K estimated history is created, its saved tier is changed to 500K, and manual compaction starts without an intervening turn. Both ordinary summarization and native compaction complete a single useful replacement. Cancellation of a stalled synthetic summary and a synthetic backend rejection terminate with no replacement or loss of the original history.

Additional regressions cover unbound/fresh-signal model resolution, per-model isolation, immutable prepared-call windows, schema/browser validation, Host settings updates, recreation from the Host-owned accepted configuration, finite staged dropdowns and the read-only indicator. These fixtures do not establish live-account capacity, installed-application acceptance or an actual production profile filesystem round trip.
