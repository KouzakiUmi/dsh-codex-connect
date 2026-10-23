# Actual locked Secret Service acceptance — 2026-10-21

## Result

The unchanged #327 package passed a bounded installed-CLI check against a genuinely locked, private GNOME Secret Service collection. The corrected run executed **11 CLI processes**; all expected success/refusal outcomes passed, the existing key survived locked reads unchanged, the failed locked migration created no key, and recovery succeeded after explicit unlock of the same owned service.

The first fixture attempt failed at its recovery control. Its four earlier CLI outcomes and native lock properties are retained as observations, not counted as a complete pass. It could not verify native entry-by-entry cleanup; the entirely test-owned container and private filesystem were removed. The corrected run verified both native entries absent, removed its temporary plugin home and removed its container.

No product source or generated bundle changed. This is additional acceptance evidence for the independently reviewed runtime, not an independent approval or a release.

## Exact source and artifact

| Item | Identity |
| --- | --- |
| #327 source | `a297fa6808982eed57c219a8a3518bd8c37b6761` |
| Packed artifact SHA-256 | `db797de70efb642369922677a9da29e62e149d45700cc4b324bd56e98d8ca8ac` |
| Committed and installed `lib/bin.js` SHA-256 | `9fc1012c6b6282b1657a68c157bbd6f915fb887f718a9bfd1323b1441932213d` |
| Corrected fixture SHA-256 | `8c26a03052c0489a5a5db1e6ac9119f2ceb75d3437700300c0504f92484c1b79` |
| Source archive SHA-256 | `a17033004a5ba17d7772f9c4066d3eca5bfb4db969d92265f7bf959233f8b2fa` |
| Runtime | Linux arm64, Node 24.19.0, kernel 6.10.14-linuxkit |
| Native binding | `@napi-rs/keyring` 2.1.0 |
| Native service packages | GNOME Keyring 42.1-1+b2; D-Bus 1.14.10-1~deb12u1; libsecret 0.20.5-3; GLib tools 2.74.6-2+deb12u9 |

The Node image is pinned to `node:24.19.0-bookworm@sha256:4196d66a565c6f195728d9952f161f4adfe2ad753052a08b7ec7f1c5a6bda42b`. Container package versions are recorded because apt repositories are not an immutable snapshot.

The source was archived from the clean fixed-head worktree, packed with npm and installed in a temporary prefix using `--legacy-peer-deps --ignore-scripts --no-audit --no-fund --package-lock=false`. Consequently this verifies installed standalone CLI/native behavior, not a complete peer-install contract or running Harness integration. The artifact hash matches the previous macOS/Linux installed acceptance.

## What actually ran

| Stage | Observed outcome |
| --- | --- |
| Unlocked setup | Two new precise OS locators verified absent; fake primary/backup files created. The first home migrated and fresh CLI status reported signed-in. |
| Native locking | Secret Service `Lock` returned the owned login collection; native `Locked` property changed from false to true. |
| Locked read | Installed `status --json` exited 1 with the redacted secure-storage diagnostic, approximately 51 ms. Both encrypted files stayed byte-identical and owner-only. |
| Locked migration | Installed explicit migration for the second legacy home exited 1, approximately 53 ms. Both legacy files stayed byte-identical and owner-only. |
| Lock retention | Native `Locked=true` verified again after each rejected operation. This was not an unavailable-service stand-in. |
| Explicit owned unlock | The existing daemon's native control socket accepted the test password; the D-Bus owner was unchanged and `Locked=false`. No daemon restart/replacement was used in the corrected run. |
| Identity and recovery | First native key unchanged; second locator still absent. First CLI status recovered. The second explicit migration and fresh status then succeeded, with an independent 32-byte key. |
| Cleanup | Both CLI logouts succeeded; keys, primary/backup files absent; signed-out status; temporary plugin home removed; container verified absent. |

The eleven CLI processes include expected nonzero refusals and signed-out statuses. Zero process timeouts or unexpected exit codes occurred in the corrected run. Key bytes, fake password and credential contents were not emitted as command arguments or environment values by the acceptance controls.

## Retained failed attempt and fixture repair

The [initial attempt](failed-daemon-unlock/native-result.json) successfully established `Locked=true` and observed both expected read/migration refusals. It then invoked a new `gnome-keyring-daemon --unlock` process. Exit zero was insufficient: the existing Secret Service still reported `Locked=true`, so the recovery assertion failed. Cleanup also retained false for native-entry absence and temporary-home removal. [The runner record](failed-daemon-unlock/runner-result.json) confirms that container was removed; no private keyring was mounted out of it.

Upstream GNOME Keyring 42.1 distinguishes daemon startup from the existing daemon's UNLOCK control operation. The corrected test connects only to the exact container-owned socket, checks its filesystem type/ownership and private parent, sends the authenticated native control request using the fake password, requires result OK, verifies an unchanged D-Bus owner, and reads the real Locked property. [Primary source identities](control-source-references.json) identify the reviewed upstream files. No external unlock helper was installed.

The [original fixture](failed-daemon-unlock/acceptance.mjs), [original plan](failed-daemon-unlock/PLAN.md), complete failed output, native properties and raw/public hashes are preserved. The [revised plan](PLAN.md) records this correction before the single corrected execution. The product and acceptance assertions were unchanged; this was not an unchanged rerun to obtain green.

## Artifacts and reproduction

- [Corrected native result](passed/native-result.json), [container/install record](passed/result.json), [runner/cleanup record](passed/runner-result.json), [raw-copy integrity manifest](passed/artifact-manifest.json).
- [Failed native result](failed-daemon-unlock/native-result.json), [runner/cleanup record](failed-daemon-unlock/runner-result.json), [raw-copy integrity manifest](failed-daemon-unlock/artifact-manifest.json).
- [Acceptance fixture](acceptance.mjs), [container setup](container.mjs), [private service session](native-session.mjs), [driver](run-linux.py).

From the evidence worktree, with a clean authorized source checkout at the fixed #327 head:

```sh
python3 docs/reviews/2026-10-21-maintenance/pr327-locked-native/run-linux.py /absolute/path/to/pr327-source
```

This creates only owned disposable test environments. The fixture refuses non-Linux, a missing container marker, a different private-home/control setup, synthetic keyring preloads, or a candidate installed outside the owned prefix. No host home, real credential store, desktop D-Bus socket or Docker socket is mounted, and the container is not privileged.

## Remaining limits and merge gate

This closes the bounded Linux locked **read/migration/recovery** row. Locked logout, interactive desktop prompting, macOS locked Keychain, Windows Credential Manager/ACL, other Linux implementations/architectures, native installed/running Harness operations and deployment remain unperformed. No real account was read, migrated or modified, and no OAuth/model request occurred.

The independent review at [13:23 UTC on 2026-10-20](https://github.com/franksong2702/dsh-codex-connect/pull/327#pullrequestreview-5585618168) expressly retained draft/unmerged status. The runtime head is unchanged, and this additional implementing-session evidence does not convert that review into approval.
