# Pawl rollout findings and improvement backlog

<!-- cspell:words Coolstead -->

Evidence collected on 2026-11-23 while adopting Pawl in Quality, Coolstead,
Astro Doctor and a Website migration pilot. This is the consolidated working
backlog; it does not claim that adoption or deployment across all projects is
complete. Checked items in the improvement sections below describe locally
implemented v0.5.0 work verified by the regression suites listed at the end.
They do not claim publication or rollout to consumer repositories. The separate
0.4.0 section records previously shipped fixes. Boundaries and remaining consumer
qualification are explicit below.

## Policy and implementation requirements

- Extend `@santi020k/pawl-policy`; the qualified consumer versions are Pawl
  0.4.0, policy 0.4.0 and Biome 2.6.8. Earlier pilot observations below explicitly
  identify 0.3.0 when applicable.
- Preserve locked rule floors, framework checks, type checking and native
  toolchains. Do not obtain a passing check by adding a baseline, weakening
  rules, widening ignores or introducing unsafe TypeScript types.
- Keep existing Santiago-owned shared ESLint configuration where it supplies
  semantic checks that the chosen engine cannot replace.
- Preserve customized configuration and file scope. Unsupported composition
  must stop before writing, with an actionable setup error.
- Keep Pawl deterministic and free of runtime dependencies. Resolve optional
  engines and plugins through public project exports.
- Require real-engine behavior tests, including invalid source, before claiming
  equivalent enforcement. A clean setup report or generated configuration alone
  is insufficient.

Priority: P1 protects enforcement and migration correctness; P2 improves adoption
and performance; P3 improves diagnostics and maintenance. Suggested order is
P1 items first, then P2 items with measured consumer benefit. The entries retain
the original rollout observations and acceptance criteria; the implementation
evidence table records the resulting local v0.5.0 behavior.

## P1: shared policy and ESLint integration

- [x] **Support migration when an extended policy already has overrides.**
      Reproduce with scoped ESLint rules and `@santi020k/pawl-policy`, which contains
      a script-scoped `no-console` override. Pawl 0.4.0 deliberately refused this
      composition. Define parent/source precedence, option inheritance
      and locked rule floors before lifting the refusal. Acceptance: compare actual
      resolved ESLint configurations and Biome behavior for existing and newly
      created files, overlapping scopes and script exceptions. Unsupported cases
      must leave all source, backup and report files unchanged. The 0.4.0 workaround was
      explicit reviewed policy composition while retaining existing ESLint checks.

- [x] **Make shared-config plugin resolution usable through public helpers.**
      Astro Doctor required `eslintPlan` with `pluginRoots` to resolve plugins
      supplied by Santiago-owned shared configs; in 0.4.0, `eslintPlanFor` and `eslint()`
      did not expose the same control. Design a consistent public integration path.
      Acceptance: a consumer using only public exports resolves the required plugins
      without private imports, duplicated plugin installation or copied internals;
      missing implementations still produce blocking setup errors.

- [x] **Verify rule implementations when supporting plugin aliases.**
      The Astro Doctor plan reported `eslint-plugin-import` missing despite an
      existing `import-x` namespace. Plugin presence alone was insufficient: three
      intended import rules were absent. The consumer bridge validates actual rule
      implementations and supplies its TypeScript resolver. Acceptance: every
      requested rule is implemented or explicitly rejected; real invalid imports
      fail, and valid TypeScript paths resolve. Do not silently treat plugin names
      as interchangeable.

- [x] **Apply locked rules to framework files without breaking processors.**
      Astro Doctor found that generic planner blocks omitted physical `.astro`
      files, while generic typed TypeScript blocks also matched deliberately
      untyped processor output such as `.astro/1_1.ts` and Markdown snippets.
      Loading policy from nested docs could also select a different policy context.
      Acceptance: physical TS, JS, CLI, configuration and Astro files retain locked
      floors; processor output receives appropriate non-type-aware rules without
      invalid parser programs. Local exceptions cannot replay locked keys. Test
      `calculateConfigForFile` and actual invalid source from root and nested
      directories, preserving the existing framework parser and host-specific
      virtual modules.

## P1: configuration ownership and repeatable fixes

- [x] **Track generated override ownership safely.**
      Pawl 0.4.0 preserves unknown inline Biome override arrays and reports
      `biome-overrides-conflict` when generated scopes differ. Even an older
      generated array could not safely be distinguished from user edits in 0.4.0.
      Design verifiable ownership metadata and a reviewable reconciliation plan.
      Acceptance: unchanged generated scopes can update; edited or unknown scopes
      remain byte-identical until explicitly reconciled; backups are recoverable;
      repeated sync is stable. Never infer ownership from a similar array shape.

- [x] **Detect competing formatter ownership before reporting fix success.**
      Astro Doctor observed Biome import organization and ESLint
      `simple-import-sort` rewriting each other's output. Adoption removed duplicate
      formatting rules while retaining semantic import checks. Acceptance: the
      planner reports incompatible owners, a supported configuration passes
      `fix -> check -> fix` with no second diff, and file-scoped Git hooks use the
      same owner as the full check. Do not remove semantic import rules as a shortcut.

- [x] **Specify and test glob semantics at every engine boundary.**
      The 0.4.0 fixes showed that Node `matchesGlob` and Biome interpret escaped
      literal brackets differently. Preserve separate comparison and emitted-pattern
      representations. Acceptance: contract or property tests against real engines
      cover literal brackets, braces, globstar patterns, negation, later inclusion, nested
      ownership and unbracketed sibling negative controls. Keep projection work
      bounded for repeated wildcards.

## P2: strict adoption and framework coverage

- [x] **Offer an explicit adoption flow without recording a baseline.**
      The published 0.3.0 pilot's `init` always recorded one. Quality instead used
      an explicit policy plus sync and fixed diagnostics. The v0.5.0 strict path uses
      `init --no-baseline` while preserving the default adoption behavior.
      Acceptance: automated adoption writes no baseline, existing findings remain
      blocking, locked rules stay enabled, and dry-run accurately describes writes.

- [x] **Improve framework import coverage diagnostics.**
      Quality and Coolstead encountered valid `astro:content`, `astro:transitions`
      and `.astro` imports reported by Biome's unresolved-import rule. Current
      consumers retain Astro Check/build and narrowly scoped engine exceptions.
      Acceptance: recognize supported framework imports or report the exact coverage
      limitation and required framework validator; misspelled ordinary imports still
      fail. Keep virtual-module allowances limited to their owning host.

- [x] **Handle scoped parser capability limits explicitly.**
      With Biome 2.6.8, `html.experimentalFullSupportEnabled` inside an override was
      accepted but did not diagnose the invalid Astro expression that the top-level
      option diagnosed. Pawl's own repository explicitly opted in at the root;
      that is not a general consumer migration. Acceptance: real-engine capability
      tests prevent a misleading scoped opt-in, customized child settings are backed
      up and preserved, and unsupported migration stays blocked until semantics can
      be maintained.

- [x] **Scope test-runner rules to the actual runner.**
      Automatic Vitest detection affected `node:test` files using `assert`;
      conditional Playwright project selection also triggered disabled-test checks.
      Acceptance: mixed-runner fixtures receive appropriate assertion rules, valid
      project selection works, and genuinely disabled tests remain detectable.

## P2: faster checks with trustworthy reuse

- [x] **Add safe, documented ESLint cache support.**
      Pawl 0.4.0 invokes ESLint without the cache flags used by Astro Doctor's former
      command. Define ownership, location and invalidation before enabling reuse.
      Acceptance: cold and warm runs agree; source, policy, config, plugin, resolver,
      lockfile and runtime changes invalidate affected results; interrupted or corrupt
      cache writes cannot produce success. Include processor and type-aware dependency
      changes. Never reuse a failed setup as a passing result.

- [x] **Avoid duplicate root and package lint traversal.**
      Astro Doctor's adoption removed repeated checks while preserving semantic
      ESLint coverage and using Biome for formatting. Add a diagnostic or documented
      integration recipe that identifies overlapping task ownership. Acceptance:
      representative files are checked once per required engine, all intended files
      remain covered, and changed shared configuration broadens validation correctly.

- [x] **Distinguish cached task inputs from uncached orchestration variables.**
      Quality and Coolstead needed exact-file exceptions where Turbo environment
      rules treated direct CI scripts as cached tasks. Acceptance: script reachability
      identifies cached consumers; actual output-affecting variables change task
      hashes, while GitHub orchestration and test-sandbox variables do not become
      unnecessary global cache inputs. Unknown reachability must be reported rather
      than assumed safe.

## P3: actionable boundaries and consumer contracts

- [x] **Explain necessary ordering and CSS exceptions.**
      Serial browser interactions, output writers, provider polling and deployment
      pagination cannot safely become parallel merely to satisfy `no-await-in-loop`.
      Reduced-motion and generated-theme overrides can legitimately need
      `!important`. Improve guidance for narrow, documented exceptions with ordering
      or rendered-behavior tests; never automatically remove these safeguards.

- [x] **Publish and test the machine-readable report contract.**
      Pawl 0.4.0 does not provide the proposed `PAWL_FORMAT=editor` integration.
      Quality's locally prepared 2.2 release instead uses a native `pawl-json` task
      parser with captured-report validation. Acceptance: versioned consumer tests
      cover valid reports, malformed output, setup failures and exit code 2;
      operational failures cannot become baseline findings or successful checks.
      Distinguish published interfaces from unreleased CLI experiments.

## Fixed in Pawl 0.4.0: retain regression coverage

- [x] Replace generated nested Biome configuration with root-scoped workspace
      overrides, preserving exact-root paths and generated-file exclusions.
- [x] Detect existing nested configurations, including ignored files that still
      govern visible source; stop before executing an unsafe check or fix.
- [x] Exclude nested workspace ownership from parent technology projections and
      preserve ordered negative patterns and later inclusion.
- [x] Escape literal bracket directories and account for Node/Biome comparison
      differences; do not expand exhausted directory-only patterns to descendants.
- [x] Keep untagged global engine rules out of technology-only projections so
      component template value imports survive fixes.
- [x] Preserve unknown inline override arrays instead of silently replacing them.
- [x] Reject scoped ESLint `linterOptions` that cannot be preserved, including
      `noInlineConfig`, before migration writes anything.

The release also patched the actual Undici consumer to 7.30.2 and tested valid
and tampered responses. A zero-advisory audit had not exposed the integrity
parsing defect; retain behavior-based security checks alongside registry audits.
Release reference: [Pawl PR 10](https://github.com/santi020k/pawl/pull/10).

## Measurements and verification boundaries

| Consumer                              | Observation                                                                                    | What it establishes                                                                                                                                   |
| ------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Quality, exact registry 0.4.0         | Uncached Pawl task: 708 ms; whole command: 1.422 s. Reused task: 0 ms; whole command: 0.687 s. | Quality task-cache reuse, not an old/new linter speedup; there was no equivalent old shared JS policy gate.                                           |
| Coolstead, five alternating warm runs | Direct Biome median: 0.3134 s; Pawl median: 0.4194 s.                                          | Approximately 0.106 s wrapper overhead with the same generated configuration; no native lint speedup claim.                                           |
| Astro Doctor                          | Local lint: 21.32 s before, 10.22 s after adoption.                                            | Approximately 52% shorter observed runs after removing duplicate traversal; not a controlled cold-cache or hosted-CI benchmark, and coverage changed. |

Quality's registry validation included eight tools with no diagnostics and 68
browser tests passing with two conditional project skips. Coolstead passed its
seven-task gate and native tests; hardware qualification remains separate.
Astro Doctor passed its full pre-push gate, 25 CI tests including eight policy
regressions, packed installation and 13 production-doc browser tests. These are
local validation results, not proof that consumer releases have deployed.

For each improvement, record the exact versions, source revision, command,
runtime, cache state and representative fixture. Compare equivalent coverage
with repeated cold and warm measurements before making performance claims.

## Evidence provenance and completion checklist

This file consolidates the Quality pilot/registry report, scoped migration
reproduction, Coolstead 0.4 adoption report and Astro Doctor adoption report.
Their original local scratch files were `quality-pawl-findings.md`,
`pawl-migration-findings.md`, `coolstead-pawl04-findings.md` and
`astro-doctor-pawl-findings.md`. They are temporary evidence, not required inputs
to this backlog; reproductions and acceptance criteria are recorded above.

Before marking an improvement complete:

1. Add a minimal real-engine regression that fails before the fix.
2. Implement the smallest central fix and verify the affected consumer.
3. Preserve the strict shared policy and prove applicable locked-rule behavior.
4. Run focused checks, then `pnpm ok` before an authorized push or release.
5. Update documentation and add a Changeset for user-visible package changes.
6. Record release/integration evidence separately from local test success.

## Local v0.5.0 implementation evidence

All sixteen proposed improvements now have a local implementation or an explicit,
tested diagnostic boundary. Configuration ownership, runner scopes and caching
are opt-in contracts where automatic inference cannot establish correctness.
No rule floors, baselines or ignores were weakened to make validation pass.

| Improvement                     | Implementation and regression evidence                                                                                                                                                                                                                                                                                                    |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Parent migration overrides      | Explicit source rules replay after parent scopes; locked floors remain. `migrate-parent-overrides.test.ts` covers parent option-only scopes, future files, reports, shared-policy script exceptions, real ESLint and Biome, and refusal before writes.                                                                                    |
| Public shared plugin resolution | `EslintIntegrationOptions` is forwarded through all public helpers. `eslint-integration.test.ts`, `eslint-framework.test.ts` and `public-resolution.test.ts` cover shared roots, actual plugins, exported paths and missing implementations.                                                                                              |
| Plugin aliases                  | Explicit namespace bindings validate actual requested rule implementations. Real import-x plus the TypeScript resolver accepts an alias path and rejects a missing import. No automatic name equivalence is assumed.                                                                                                                      |
| Framework locked floors         | Shared `baseConfig` and processor controls preserve actual Astro parsing and untyped virtual modules. Real Astro, TS, CLI and explicit-root subprocess tests prove floor enforcement. Configuration appended outside Pawl's returned array is outside its enforcement boundary.                                                           |
| Generated scope ownership       | Exact versioned ownership metadata, backups, reviewed dry-run actions and stale-plan/path checks. `biome-ownership.test.ts` proves edited/unknown scopes and external symlink targets remain unchanged.                                                                                                                                   |
| Formatter ownership             | Read-only preflight resolves ESLint file scopes before fixes. `formatter-ownership.test.ts` covers conflicts, disjoint Biome exclusions, inherited uncertainty and a stable fix/check/fix cycle. Semantic rules remain active.                                                                                                            |
| Glob contracts                  | `engine-glob-contract.test.ts` runs real ESLint/Oxlint literal brackets, braces, ordered exclusions, re-inclusion and nested ownership. Existing Biome projection tests retain the repeated-wildcard bound.                                                                                                                               |
| Adoption without baseline       | `--no-baseline` and `InitOptions.baseline: false`; five strict-init regressions prove invalid source stays blocking, existing baselines remain unchanged and dry-run is accurate.                                                                                                                                                         |
| Framework import coverage       | Doctor reports exact Astro/Biome limitations without suppressing ordinary import diagnostics. `framework-coverage.test.ts` tests both host imports and invalid ordinary imports.                                                                                                                                                          |
| Scoped parser capability        | Real Biome regression distinguishes root from scoped HTML opt-in. Nested/custom migration remains blocked; no automatic global parser change is claimed.                                                                                                                                                                                  |
| Runner scopes                   | Explicit `testRunners` policy scopes across Biome, ESLint and Oxlint; mixed node:test/Vitest fixtures and real Playwright selection/disabled controls. Universal focused/skipped checks are not narrowed. Locked runner scopes reject unsafe narrowing.                                                                                   |
| ESLint cache                    | Explicit deterministic-input declaration; complete filesystem/dependency/environment/runtime fingerprint around each real ESLint execution, atomic promotion, corruption misses and signal/report validation. Cache tests cover changed inputs, processors, malformed reports and failed setup.                                           |
| Duplicate traversal             | Doctor reports declared traversal overlaps and unknown wrappers. `lint-traversal-engine.test.ts` demonstrates duplicate real ESLint findings before consolidation and retained ESLint/Biome coverage after.                                                                                                                               |
| Cached task reachability        | Conservative static evidence distinguishes standalone/workspace task declarations and reports unknown loading. `task-cache-inputs.test.ts` checks real Turbo hashes for output variables, unrelated orchestration/sandbox variables and shared config changes. No automatic lint exemption or proof of arbitrary JavaScript reachability. |
| Ordering/CSS guidance           | Catalog/explain advice and `guide/reviewed-exceptions.md` preserve necessary serial operations and reduced-motion/theme CSS, with narrow documented policy exceptions and behavior-test requirements.                                                                                                                                     |
| Report consumer contract        | Additive `reportVersion: 1`, public `readCheckReport` validation and real CLI subprocess tests. Malformed output, signals, setup failures and inconsistent statuses cannot become success. No `PAWL_FORMAT=editor` interface is claimed.                                                                                                  |

### Validation and qualification boundary

The implementation commit `5898a0f` is integrated into `release/v0.5.0` through
merge `fd538bd`, alongside the tooling commit `f29ff1c`. Changesets generated
version 0.5.0 for both public packages. The source of truth for the tested versions is
the manifests and lockfile: pnpm 11.6.0, Node 22.23.4 for the full repository gate,
Biome 2.6.8, ESLint 10.15.0 and Oxlint 1.94.0. Real ESLint integration fixtures use
TypeScript 6 separately from the library's TypeScript 7 compiler because the
installed typescript-eslint peer contract does not support TypeScript 7.
Astro plugin 1.7.0 is the latest major compatible with Pawl's declared minimum
Node runtime; newer plugin majors require a higher minimum.

The full `pnpm ok` gate passed on the integrated 0.5.0 implementation with Node 22.23.4:
634 library tests, nine shared-policy tests, eight docs tests and 26 release-script
tests, plus build, type checking, Pawl, CSpell, Knip and generated-file checks.
Earlier formatting issues and test-name warnings were corrected. The docs audit
checked 33 pages with zero findings; Astro Doctor scored 100/100. Local release integration and publication are separate steps; nothing has been
pushed or published by this work. Final independent review resolved both runtime
export-condition selection and physical-file processor-scope bypasses, with 33
focused regressions passing. `pnpm release:check` passed, and
`pnpm check:packed-install` installed the 0.5.0 tarball and verified its CLI and
public library entry in an empty consumer project.

Remaining boundaries are intentional and documented: arbitrary executable config
requires a truthful deterministic-input declaration for cache reuse; hashing can
cost more than it saves; complex task reachability remains unknown; custom Biome
source-action inheritance needs explicit reconciliation; package pattern exports
are rejected rather than bypassed; Oxlint's native node:test skip coverage is not
claimed. Consumer repository deployment and production qualification are separate
from these local engine regressions. Do not remove this evidence or equate the
checked boxes with published consumer adoption.

### Local cache measurement

The actual typescript-eslint fixture checks one unchanged TypeScript entry with
`no-floating-promises`. Changing an imported declaration from a void return to
`Promise<void>` invalidates the warm cache and agrees with an uncached check;
reverting the declaration restores a clean result. Three native-cache-cold/warm
pairs took 1084/499 ms, 665/602 ms and 710/510 ms (medians 710/510 ms), with
Node 22.23.4, ESLint 10.15.0, TypeScript 6.0.3 and typescript-eslint 8.74.0.
Package-copy fixture setup is excluded and operating-system caches were not
controlled. This is local single-file evidence, not a whole-repository or hosted
CI speedup claim. Full workspace fingerprinting was separately observed around
5.6 seconds per snapshot; cache reuse can be slower for such workloads.
