# Locked native Secret Service acceptance — 2026-10-21

## Scope declared before execution

Use the unchanged #327 runtime `a297fa6808982eed57c219a8a3518bd8c37b6761`, packed and temporarily installed inside the pinned Linux arm64 Node 24.19.0 container. Reuse the prior isolated installation/session driver, adding only the D-Bus CLI needed to set and inspect the owned collection's lock state.

Create a fresh container-only GNOME Keyring home and private D-Bus session. Mount only this run's source/fixtures and evidence output; mount no host home, credential store, desktop/session socket or Docker socket. Use only the fake password and independently addressed fake-data entries created by this run. Reject execution outside that container/private-home setup.

## Fixed acceptance sequence

1. Establish an unlocked native collection. Create two new plugin homes and verify their precise locators absent.
2. Migrate fake primary/backup data in the first home; verify an actual native key and a fresh signed-in CLI process.
3. Call native Secret Service `Lock` on the private default collection. Verify its native `Locked` property is true.
4. Execute installed CLI status on the encrypted home; require a bounded refusal and unchanged encrypted files.
5. Execute explicit installed CLI migration on the second, legacy home; require a bounded refusal and unchanged legacy files.
6. Verify `Locked` remains true after each refusal. Unlock only this run's private collection with its fake password through the existing owned daemon's control socket.
7. Confirm the first key/files are unchanged, and no key was created for the failed migration. Verify status and migration recover after explicit unlock.
8. Log out both owned entries; verify native keys and files absent, signed-out status, temporary-home cleanup and container removal.

Capture all outcomes. A timeout, unexpected unlock, file/key mutation or cleanup failure is not a pass. No automatic result-based retry. Recovery after a deliberate unlock is an explicit different state in the plan.

This covers actual locked read/migration and recovery in headless GNOME Keyring. It does not cover locked logout, interactive desktop prompting, macOS locked Keychains, Windows Credential Manager, real credentials or native installed/running Harness behavior.

Primary API references: [Secret Service locking](https://specifications.freedesktop.org/secret-service/latest/unlocking.html) and [GNOME Keyring daemon manual](https://manpages.debian.org/bookworm/gnome-keyring/gnome-keyring-daemon.1.en.html). The actual package versions and native property outputs will be saved with the run.
## Fixture correction after the first retained failure

The initial daemon-command version established a genuinely locked collection and observed both expected CLI refusals, but `gnome-keyring-daemon --unlock` exited zero while the existing service still reported Locked=true. The attempt therefore failed at recovery and could not verify native entry-by-entry cleanup. Its test-only container was removed; the private filesystem/store did not survive. All outcomes and the initial fixture/plan are retained under `failed-daemon-unlock/`.

Inspection of upstream GNOME Keyring 42.1 shows that a new `--unlock` invocation follows daemon startup, while the native control client provides a distinct existing-daemon UNLOCK operation. The revised fixture sends only the fake test password to the exact owned socket, validates socket ownership/type, requires an OK response, verifies the D-Bus service owner is unchanged, and checks Locked=false. It does not restart or replace the service. The same read/migration refusal, identity, recovery and cleanup requirements remain.

One corrected execution is authorized as a fixture repair, not an unchanged rerun in search of green. Preserve both attempts regardless of the corrected outcome. Primary source URLs and blob identities are in `control-source-references.json`.
