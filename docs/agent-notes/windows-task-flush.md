# Windows Task flush access

Refs #329. Task state updates and new artifact writes reopen the atomically replaced file before syncing it. Windows requires write access for this flush. These two post-write opens now request `O_RDWR` on Windows; POSIX continues using `O_RDONLY`. No create/truncate flags, permission changes, retry or swallowed errors are added. Ordinary state/artifact reads and artifact reuse retain their read-only handles, including private POSIX 0400 files.

The red regression runs the real stores against real temporary files and handles, with only Windows flush access requirements simulated. Both successful-write cases failed before the change; injected-error controls passed. Tests assert that sync failures still reject the caller and close the handle. This simulation is not native Windows acceptance.

The separate native suite uses no filesystem/process mocks. Windows CI runs a primitive control (read-only sync fails; writable sync succeeds), state creation/replacement/readback, and new artifact creation/read/reuse. POSIX additionally checks 0400 read/reuse. Platform controls are explicitly conditional; failures do not enable privileges or silently skip cases.

This is a flush access correction, not a redesign of the atomic writer or proof of power-loss durability. Replacement may already be visible when a later flush fails; callers receive the error, and no rollback is claimed. Directory sync remains POSIX-only. State read identity, write-side path/handle identity races and other #329 subitems remain separate; this change must not close the whole issue. Task activation stays frozen. No credentials, saved formats, lock protocol, host permissions, dependencies or release defaults change.
