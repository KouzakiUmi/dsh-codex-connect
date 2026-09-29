# Canary maintenance loop

The daily canary now distinguishes skipped channels from executed checks in JSON and Actions summaries. Existing version trackers refresh their latest bounded evidence and respect explicit not-planned closure decisions. The run-health observer covers daily and weekly failures that have no complete set of version trackers, including failures before reports exist. It uses GitHub run/job metadata only and never executes a triggering revision or downloads its artifacts.

The focused regression gate executes the observer's actual embedded script against a fake GitHub API. Scenarios include setup-like failures, cancellation, timeout, partial channel tracking, tracker-write failure, late completion, foreign branches/repositories, successful recovery and explicit maintainer closure decisions. Existing child-process fixtures verify that skipped versions do not launch checks and declared versions remain actively tested. These tests do not establish live GitHub delivery or full user acceptance.

The periodic Codex Sweep owns investigation and local repair, with repository writes, pull requests, merging and publishing subject to the user's action-specific authorization. It also detects absent runs and observer failures; the observer cannot monitor its own outage. See the canonical procedure in `.github/UPSTREAM_DSH_CANARY.md`.
