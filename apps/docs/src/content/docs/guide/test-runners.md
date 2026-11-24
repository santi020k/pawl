---

title: Mixed test runners
description: "Assign explicit test runner scopes without weakening shared test safety rules."
---

Installing Vitest does not mean every test uses Vitest's assertion API. Declare
ownership explicitly when a repository mixes runners:

```ts
export default definePolicy({
  testRunners: {
    vitest: ['packages/unit/**/*.test.ts'],
    playwright: ['tests/browser/**/*.spec.ts'],
    node: ['scripts/**/*.test.ts']
  }
})
```

Each value is a nonempty list of positive root-relative file globs. Unknown
runner names, empty lists and exclusions are rejected. The names are `vitest`,
`jest`, `playwright` and `node`. A later policy replaces only the runner it names.
File names and source imports are not guessed to determine ownership. Include all
current and intended future test files in the declared scopes.

Runner-specific rules stay at their configured levels inside their declared
files and do not run outside those files. Policy overrides and rule options still
apply inside the runner's scope. Without `testRunners`, existing enforcement is
unchanged. Biome uses shared implementations for Vitest and Jest conventions, so
its assertion scope is the union of declared Vitest and Jest files; declare both
when both are used. Native Node assertions do not become Vitest assertions merely
because the project depends on Vitest.

Focused and skipped-test safety rules remain global. A scope that would narrow
a locked runner-specific rule is rejected; revise the policy that owns the rule
instead of adding a local exception. Scope declarations do not install plugins,
create a baseline, disable type checking or replace the test command.

## Conditional Playwright projects

Biome 2.6.8's `noSkippedTests` rule has no option to distinguish conditional
Playwright project selection from an unconditional skip. Selecting explicit
Playwright scopes does not weaken that shared rule. When a supported Playwright
ESLint rule option provides the required semantics, use ESLint as the linter and
verify both the permitted conditional case and a genuinely skipped test. Keep
locked floors and the shared policy intact; selecting a different runner is not
permission to suppress skips.

## Engine boundaries

Pawl preserves each engine's coverage rather than claiming that all APIs have
identical support. In particular, Oxlint 1.94.0's Vitest skip check does not report
a `node:test` skip. Biome 2.6.8 does report that case. Keep the Node test runner's
own checks and required CI execution, and verify invalid fixtures for the engine
you select. `node` scopes record the assertion API ownership; they do not add a
new parser or a Pawl implementation of Node's test rules.
