# DSH 0.2.0 candidate compatibility

Published [Alpha 4.54](https://github.com/franksong2702/dsh-codex-connect/releases/tag/v0.1.0-alpha.4.54) contains the compatibility repair merged in [PR #294](https://github.com/franksong2702/dsh-codex-connect/pull/294). Its release commit is `bf4fe177decb06b1b224fa642a6233594f66e40b`; independent verification matched the public npm package to the original workflow artifact and release tag. The published Alpha 4.53 artifact supports only DSH 0.1.7-rc.1 and rc.2; do not apply Alpha 4.54's results to that older artifact. Catalog entries record exact installation/runtime checks, not full user acceptance.

## Failure and repair

Canary tracker [#291](https://github.com/franksong2702/dsh-codex-connect/issues/291) stopped at the installation version gate for 0.2.0-rc.1. A local candidate with expanded peers passed that host, but failed real assembled synthetic requests on 0.2.0-rc.2. The host's pi-ai 0.87 normalizes the system prompt and tool definitions into an initial system message before calling a provider. The plugin-owned pi-ai 0.85.1 provider expects those fields outside the transcript. Normal conversations failed before HTTP dispatch with `PI_AI_ERROR`; an empty-message probe did not detect the mismatch.

The provider adapter translates only the initial system message back into the old provider vocabulary. It preserves prompt text, tools and remaining history without mutating the input. Old-host contexts pass through unchanged. Later system messages, sections, tool removals and mixed shorthand/transcript inputs fail explicitly rather than silently losing model instructions. Dynamic tool or system-message support is not added.

The plugin's model library, OAuth implementation and frozen feature defaults are unchanged. The installed request probe now includes system instructions, a tool definition and a user message, asserts their outbound values, and runs before legacy recovery fixtures. No real account credentials or model requests are used.

Diagnostics resolve DSH peers from the explicit host anchor, but resolve plugin-owned pi-ai from the plugin. Reading the host's pi-ai version against the plugin's pinned dependency previously produced a false unverified result when those versions diverged. The regression fixture places pi-ai 0.87.1 in the host and confirms that plugin diagnostics still report its own 0.85.1.

## Verification boundary

Alpha 4.54 passed `pnpm run check` (1548 tests), `pnpm run test:browser` (53 tests) and `pnpm --silent run check:dsh-matrix`. The matrix covers exact hosts 0.1.7-rc.1, 0.1.7-rc.2, 0.2.0-rc.1 and 0.2.0-rc.2 using identical packed bytes. These checks establish keyless installation/runtime compatibility, not live OAuth, paid quota, full user acceptance or deployment. Separate deployment approval remains required before daily-service use.
