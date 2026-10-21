# Artifact read and reuse identity

Refs #329 and the selective-adoption cautions in the closed, unmerged #330. This repair addresses only the artifact read/reuse boundary. It does not adopt that branch's state-store, probe/login, SDK, or writable-flush changes.

The actual `TaskDelegationArtifacts` module accepted a digest-named link to matching external bytes in a simulated Windows filesystem where no-follow flags were ineffective. Both `get` and `put` reuse failed the new rejection test; the regular-file control passed. These are mocked Windows semantics, not native Windows acceptance:

```sh
pnpm exec vitest run tests/task-artifact-read-identity.spec.ts
```

The reader now checks a regular single-link leaf before opening, then binds native bigint device/inode and stable size, link, mode, owner and nanosecond clock metadata across the path, opened handle and read. Reads consume at most the observed bounded size plus one sentinel byte and handle partial reads. It closes the handle, rechecks directory safety and the current leaf, then verifies the digest and decodes JSON. Initial target absence retains `ENOENT`; disappearance or failure after observing a target is unsafe and cannot authorize `put` to overwrite it. Uncertain handles are closed in `finally`; close failures reject rather than returning data.

The Windows job runs `tests/task-artifact-native.spec.ts` and the mocked regressions. Native tests use real temporary files and handles; wrappers restrict read sizes or schedule controlled replacements at open/read/close boundaries. They cover ordinary reads/reuse, partial multibyte reads, symlinks, hardlinks, regular replacements with identical content, directory-link replacement, observed disappearance, initial absence, metadata mutation and close failure. A Windows-only ordinary-open control confirms its fixture link is readable; it does not assert that every Node/Windows no-follow implementation has identical behavior. The protected reader must reject the link independently. A POSIX-only positive control preserves private read-only files. Tests do not enable privileges or skip failed link creation to claim acceptance.

These checks bind an observed read to its path/handle; they do not make a mutable same-owner filesystem permanently immutable after return, establish crash durability, or grant authority from artifact content. Saved formats, hashing, locks, permissions and the public Task pause remain unchanged.

Remaining #329 boundaries include state-file identity/recovery and Windows writable-fsync/write-side durability. In particular, new artifact creation and state updates still retain their existing flush path; this PR does not certify them or close #329 as a whole. No real account, credential, daily profile, Desktop, service, release or live model is used. Native Windows results must come from the new CI job, not from the local simulated platform tests.
