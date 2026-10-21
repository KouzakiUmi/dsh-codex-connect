# Recovery entry admission after route gaps

Refs #314 and the UI portion of #329. Current main already unregisters the Task HTTP route with its consumer and resolves live authentication. This repair preserves that lifecycle code and the public Task pause.

The remaining browser defect was reproduced in the actual Chromium component: initial empty 404/405 responses, or three consecutive `TASK_LIVE_ROOT_REQUIRED` 409 responses, led to the generic failed-read state and displayed “Existing task controls” without confirming any task. The baseline regression command failed all three new cases while the nine existing cases passed:

```sh
pnpm exec vitest run --config vitest.browser.config.ts tests/browser/adaptive-task-publication.browser.client.spec.tsx
```

Initial missing-route and missing-root reads now share at most three GET attempts with the existing abortable 250/500 ms waits and 15-second operation deadline. A returning route can still expose an existing task, including mixed 404/405/409 sequences. Persistent initial absence stays entry-free and is never decoded into invented `off` state. Missing-route bodies are not parsed as JSON.

Once a non-off task has been confirmed in this session, later failures retain an explicit re-read path, including repeated route gaps after the failed read has cleared the displayed state. Stop/manual commands are dispatched once; uncertainty disables stale safety exits until a fresh authenticated read succeeds. Session changes cancel old backoff and prevent stale responses from creating controls. Other authentication, conflict and malformed-state failures retain the existing unconfirmed-state policy; this is not blanket suppression of recovery errors.

Regression coverage exercises persistent and transient initial gaps, mixed readiness responses, both Stop/manual failures for all three statuses, repeated reads, unchanged 401/other-409 handling, lost mutation responses, and cancellation on session changes. Browser transport/state fixtures are synthetic and do not establish live-account or installed Desktop acceptance. No server lifecycle, permission, persisted-state or accounting change is made.

This does not repair or certify the separate Windows artifact/file-durability issues in #329, and it does not justify closing that issue as a whole. It is an unpublished source repair, not a replacement of the immutable Alpha 7 package. No daily profile, service, release or credentials are changed.
