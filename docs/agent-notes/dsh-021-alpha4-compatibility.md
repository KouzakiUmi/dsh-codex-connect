# Exact DSH 0.2.1-alpha.4 source candidate

Canary [#339](https://github.com/franksong2702/dsh-codex-connect/issues/339) rejects source `ce50a988ca4a3827c544c67bb4db709980501420` at `isolated-install` on DSH `0.2.1-alpha.4`. The stock tarball install checks DSH peers before mounting the plugin, rejects the missing exact version and restores the previous profile. Adding only that peer version to a temporary package allowed its unchanged runtime to pass the existing synthetic installed-host checks; that diagnostic-only experiment did not declare or publish support.

## Local repair

Declare only exact `0.2.1-alpha.4` in the DSH peers, runtime diagnostic list, packaged compatibility metadata and strict development checker. Retain all seven earlier exact hosts, the `0.1.7-rc.1` development SDK, plugin-owned pi-ai `0.85.1`, Node range and feature defaults. Later Alpha and stable versions remain unverified; mixed or missing host metadata still cannot report compatible.

The client configuration wrapper also preserves an older Host mirror's `unavailable` state while compiling against newer mirrors typed as `idle | loading | ready`. Widen only the local status observation to `string`; do not change Host declarations or suppress TypeScript diagnostics. Missing view, missing namespace, native-form acceptance and subscriptions keep their existing behavior. Both alpha.3 and alpha.4 published settings-mirror declarations already omit `unavailable`, so this corrects an existing cross-version type mismatch rather than a new alpha.4 runtime API break.

Upstream alpha.4 adds plugin-market remotes and changes command-chip/editor and terminal-status internals. The plugin's consumed tool-result fields, session methods and slot interfaces remain unchanged against alpha.3. Full stock host packages must stay on one exact version; this candidate does not patch the Host or bypass its compatibility checks.

## Verification and delivery limits

Relevant verification comprises the repository's keyless `pnpm run check`, focused client state regressions, a client typecheck against the exact published alpha.4 declarations, and the stock installed-host matrix using identical packed bytes. These checks cover installation, diagnostics, preserved defaults, model preparation, synthetic requests/images and retained recovery. They do not resume frozen development or establish live OAuth, real models/images, an authenticated new-host browser session, physical-device or full user acceptance.

This is an unreleased source candidate. Its development version label remains `0.2.0-alpha.4`, but modified bytes must not be confused with that immutable public archive. `verified-compatibility.json`, published version guidance and npm tags remain unchanged. No push, PR, merge, release, deployment, daily-service restart or host upgrade is included; any future publication requires a distinct artifact/version and separate authorization.
