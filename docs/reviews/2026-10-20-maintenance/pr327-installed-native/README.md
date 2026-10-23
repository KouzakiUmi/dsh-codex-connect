# PR #327: installed CLI with native OS stores — 2026-10-20 continuation

## Result and exact candidate

The installed standalone CLI passed bounded native-store acceptance on **macOS
arm64 / Node 22.22.3** and **Linux arm64 / Node 24.19.0**. Both runs tested the
unchanged PR #327 head:

`a297fa6808982eed57c219a8a3518bd8c37b6761`

Tree: `155f19ea35967116f69449e65f5035ff26b5a702`.

The candidate already contains main
`e5579b71339ba932dec7dfba497fc97df8fbf124`. No product source or generated bundle
was changed for this continuation. Evidence and opt-in reproduction fixtures
are on the separate #375 evidence branch so the independently reviewed runtime
commit stays unchanged.

| Artifact | SHA-256 |
| --- | --- |
| Packed npm artifact on both platforms | `db797de70efb642369922677a9da29e62e149d45700cc4b324bd56e98d8ca8ac` |
| Committed and installed `lib/bin.js` on both platforms | `9fc1012c6b6282b1657a68c157bbd6f915fb887f718a9bfd1323b1441932213d` |
| Passing native acceptance fixture | `672ce8c8e84b1c2cae3b71d89f9338a5c19a71d217480abe4c8e8ce5c5a20746` |

The package was installed in a new temporary npm prefix with lifecycle scripts
disabled and peer dependencies omitted for the standalone CLI. It was not linked
to the source tree. The shipped CLI bundles its other runtime modules; its real
`@napi-rs/keyring` 2.1.0 dependency was installed and loaded from that prefix.
These checks cover the installed CLI, not a booted Harness profile or the
package's full peer-dependency installation contract.

## Executed acceptance

Each passing platform run made **17 fresh CLI process invocations**, including
expected nonzero exits. A passing fixture means those expected refusals and the
successful operations both matched their assertions.

| Behavior | macOS Keychain | Linux Secret Service |
| --- | --- | --- |
| Empty status reports signed-out without creating a key | Passed | Passed |
| Plaintext access and migration without confirmation are refused, files unchanged | Passed | Passed |
| Explicit fake-data primary and backup migration | Passed | Passed |
| Independent 32-byte native keys, distinct from the pathname locator | Passed | Passed |
| Version-3 AES-GCM envelopes, owner-only files, no fixture values in ciphertext files | Passed | Passed |
| Fresh installed CLI process reports signed-in | Passed | Passed |
| Tampering is refused without changing the native key | Passed | Passed |
| Missing decryption key is refused without replacement or file mutation | Passed | Passed |
| Unavailable backend is refused, with the original key/file unchanged | Isolated OS-home profile without a Keychain | Invalid private D-Bus address |
| Logout removes both test files and the test-owned native key | Passed | Passed |
| Final cleanup readback | Two locators absent; home removed | Two locators absent; home removed; container removed |

No OAuth login, token refresh, provider/model request, real-account import,
default plugin-home access, daily installation, service restart or release was
performed. Only fake fixture data and explicitly authorized test-owned entries
were used. The fixture refuses synthetic keyring preloads and process hooks.
Each native locator derives from a fresh temporary pathname; an unexpected
pre-existing locator causes an abort before ownership or deletion. Owned
locators are recorded before mutation for interrupted-run cleanup.

The macOS process preserves the OS home only to locate the user's normal
Keychain service. Every plugin invocation receives its own temporary
`DSH_HOME`; only this test's independently addressed Keychain entries are read
or modified. Test data, temporary installations and npm caches were removed.

Linux used the pinned public image
`node:24.19.0-bookworm@sha256:4196d66a565c6f195728d9952f161f4adfe2ad753052a08b7ec7f1c5a6bda42b`,
kernel `6.10.14-linuxkit`, and a private D-Bus session with a fresh GNOME Keyring
home. Installed native packages were `dbus 1.14.10-1~deb12u1`,
`gnome-keyring 42.1-1+b2` and `libsecret-1-0:arm64 0.20.5-3`.
Only the owned source archive/fixtures and evidence output were mounted.
The host home, host credential store and Docker socket were not mounted.
The container was not privileged. Its private daemon and filesystem disappeared
with the verified container removal.

The daemon's documented `--unlock` behavior creates a login keyring if absent;
`--components=secrets` restricts the initialized components. The test supplied
an explicitly fake password over stdin inside that private container:
[Debian's GNOME Keyring daemon manual](https://manpages.debian.org/bookworm/gnome-keyring/gnome-keyring-daemon.1.en.html).
No existing login keyring was unlocked or relocked.

## Failures retained and corrected

1. **Initial macOS setup failed** before any entry was owned or any CLI command
   ran. Isolating the operating-system `HOME` as well as the plugin home made
   the native library report that no default Keychain could be found.
   [Original result](macos-initial/native-result.json) and original fixture/driver
   are retained. Zero entries were created; its temporary home/install were
   removed.
2. **The corrected OS-home setup reached the installed CLI but the new fixture
   failed.** It expected an internal exception phrase (`explicit migration`).
   The CLI deliberately uses the closed public diagnostic vocabulary in
   [auth-error.ts](https://github.com/franksong2702/dsh-codex-connect/blob/a297fa6808982eed57c219a8a3518bd8c37b6761/src/auth-error.ts#L30-L35).
   [This failure](macos-fixture-mismatch/native-result.json) and its fixture are
   retained. Two absence-checked locators were owned, no native key was created,
   and both were verified absent at cleanup.
3. The fixture was aligned with the CLI's public diagnostic contract. Exit,
   secret-redaction, file-integrity and native-key assertions remain. The
   corrected macOS run passed all listed behaviors; the first Linux execution
   of that same fixture passed. Product code was unchanged throughout.

These were specific acceptance-harness corrections. They are not passing
results and are not hidden behind the final passes. PR #358's suites were not
rerun during this continuation.

## Review, checks and remaining limits

At the [saved GitHub readback](github-readback.json), all **ten** checks on exact
head `a297fa6` and all **four currently required** checks were successful.
The required checks are Node 22 and 24 validation, dependency review and browser
regression. No CI rerun, scanner suppression or new alert dismissal was requested.

A new [independent static review at 13:23 UTC](https://github.com/franksong2702/dsh-codex-connect/pull/327#pullrequestreview-5585618168)
found no confirmed new blocking defect in its stated scope. It is **COMMENTED**,
explicitly not an APPROVE recommendation, and explicitly asks to keep the PR
draft/unmerged. This continuation supplies new native evidence; it does not
rewrite that review into approval or use this implementing ChatGPT session as
an independent reviewer.

The review's previously unavailable live inventory was partially supplemented:
the readback returned one open CodeQL finding,
[alert 32](https://github.com/franksong2702/dsh-codex-connect/security/code-scanning/32),
`js/shell-command-injection-from-environment`, medium, on main `e5579b7`.
Its command-launching helper paths are unchanged between main and this PR.
This record does not establish the alert as actionable or a false positive.
It remains open and unchanged. The open Dependabot query returned no entries;
the secret-scanning inventory was not queried. Green PR checks do not mean the
repository has zero security alerts.

Still **not performed**:

- Native Windows Credential Manager and inherited-ACL acceptance.
- A genuinely locked native-store test; the new negative checks establish
  unavailable-store behavior, not locked-store behavior.
- Native credential operations through an installed/running Harness profile,
  physical desktop acceptance, real-account migration or deployment.
- Linux desktop, x64 or other Secret Service implementations. The new Linux
  result is specifically the isolated arm64 GNOME Keyring container above.

Earlier source-level macOS and synthetic CI/Host results remain at the
[original acceptance record](https://github.com/franksong2702/dsh-codex-connect/blob/a297fa6808982eed57c219a8a3518bd8c37b6761/docs/reviews/2026-10-20-pr327/README.md).
This later record supersedes only the previously unperformed installed-CLI and
bounded Linux native rows. It does not turn synthetic Host matrices into native
Host acceptance.

**Disposition: retain draft and the independent acceptance/review gate.**
No merge was performed.

## Reproduction and integrity

After separately authorizing native test entries, use a clean isolated checkout
of the exact candidate and the provided fixtures. Both drivers verify the
candidate HEAD and clean state before packaging.

```sh
python3 run-macos.py /absolute/path/to/clean/pr327-checkout
python3 run-linux.py /absolute/path/to/clean/pr327-checkout
```

The Linux driver requires an already running Docker daemon and the pinned image;
it does not start or upgrade Docker. Both drivers create only temporary test
resources. The macOS driver retains its owned installation if native cleanup
is uncertain; the fixture leaves only its own locator recovery metadata.

[manifest.json](manifest.json) lists the published files and raw/published hashes.
Public copies normalize terminal escapes/trailing whitespace and redact local
user/temp-root paths where present. Outcome, assertion, command exit and
cleanup records remain intact. Reproduction scripts and initial failure
snapshots are included; no token, native key, encrypted fake-data file or
keyring database is published.
