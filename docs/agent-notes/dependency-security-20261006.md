# Remaining math dependency patch — 2026-10-20

PR #312 originally proposed four transitive patches. Main has since incorporated the Undici, source-map-js and compression patches through the [dependency security floor](dependency-security-floor.md) work. This revision removes their redundant overrides and addresses only the deferred nested KaTeX copy.

`micromark-extension-math@3.1.0` requests KaTeX `^0.16.0`, selecting 0.16.47. [GHSA-238p-pmpm-9mq7](https://github.com/advisories/GHSA-238p-pmpm-9mq7) affects versions from 0.11.0 through versions before 0.18.2: inherited renderer options can bypass trust restrictions when options prototypes or the global prototype have already been influenced elsewhere. KaTeX itself does not introduce prototype pollution, and rendering a string alone does not execute it in a page.

The override is restricted to this exact consumer and reuses the existing direct KaTeX 0.18.9; it intentionally crosses the consumer's declared `^0.16.0` range. This is a compatibility decision, not an ordinary in-range patch. The extension's HTML adapter calls the public `renderToString(value, options)` API and sets `displayMode`; it does not use KaTeX internals. The remaining lock change replaces only its KaTeX edge and removes the now-unused KaTeX 0.16.47 / commander 8.3.0 nodes. No direct manifest, Host SDK, Node range, product runtime, generated library, permission, default or release version changes.

The regression resolves KaTeX from the actual math-extension consumer. It checks the patched renderer identity and rejects inherited `trust`, using a harmless `example.invalid` URL without global prototype mutation, network requests or HTML insertion. The unchanged baseline fails those two checks. It also exercises the real markdown parser and math HTML adapter for inline/display formulas, macro isolation, strict and nonthrowing escaped errors, explicit trust options and math AST values. These checks support this consumer's known API use; they are not exhaustive TeX visual compatibility or live Host acceptance.

Remove the override after a newer upstream math extension accepts a patched KaTeX line, then rerun consumer resolution, rendering/trust regressions and the relevant package/browser gates without it. The exact-consumer selector does not silently override a future extension release; an affected future resolution must fail the floor test and be reviewed again. #321's direct KaTeX patch and #355's broader KaTeX 0.19 batch are separate proposals; neither is merged by this change.

This repairs the repository's development dependency graph. It does not repair dependencies in externally installed Host packages, prove exploitation in this plugin, or constitute a repository-wide security audit. No real credentials, OAuth, model calls, daily profiles or services are involved.

## Validation of this revision

On Node 24.13.0 / pnpm 10.30.3 against main `e83b54d0709f161c4d9416c33672f8cf2f65baa1`, the unchanged dependency graph fails two of the eight math controls (patched consumer resolution and inherited trust); the other six pass. The same eight controls and all 22 existing dependency-security cases pass after the narrow override. Frozen script-disabled installation succeeds. The parsed lock graph differs only by the exact-consumer override, one KaTeX edge and removal of two unused package/snapshot nodes; importers and every other package/snapshot remain unchanged.

The baseline audit reports only the KaTeX low advisory; the candidate audit reports no advisories. Complete repository checks (including types, lint, build/imports/contracts and packaging) pass, as do all 14 Chromium files / 87 tests. These are local synthetic results; CI, independent review, merging and release are separate states.
