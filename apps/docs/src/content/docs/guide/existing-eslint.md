---

title: Existing ESLint setups
description: "Keep a shared ESLint config, its plugins and framework processors with pawl, give imports one sorter, scope test runners, and know where Astro needs its own validator."
---

Most repos that adopt pawl already have an ESLint setup worth keeping: a shared config, framework plugins and processors, more than one test runner. This page covers composing them with pawl without losing a check.

## Shared ESLint plugins

Pawl resolves plugins from the consuming project by default. When a shared
configuration supplies them, pass its directory through `pluginRoots`:

```js
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { eslint } from '@santi020k/pawl'

export default eslint({
  root: import.meta.dirname,
  pluginRoots: [dirname(fileURLToPath(import.meta.resolve('eslint-config-company')))]
})
```

Resolution uses the package's public exports. Import-only root entries, concrete
subpath exports and package self references are supported. Denied subpath exports never fall
back to a private entry or `main`; pattern-only exports require an explicit public
entry and produce a setup error. The consuming project is searched
first, then the supplied directories in order. A package that exists but fails
to load reports that failure instead of silently falling through to another copy.
Use an explicit `root` so invocation from a nested documentation directory uses
the same policy.

The public export resolver honors `module-sync` and custom Node conditions and
captures runtime flags when Pawl loads. Keep `NODE_OPTIONS` and `process.execArgv`
unchanged before loading Pawl. Ambiguous runtime flag syntax is rejected; use
`--option=value` for an unrecognized flag that takes a value.
Experimental Node config-file flags are unsupported because their runtime
conditions cannot be verified safely.

For a plugin supplied by a shared configuration, `plugins` explicitly binds its
actual implementation to an ESLint namespace:

```js
import importPlugin from 'eslint-plugin-import-x'
import { eslint } from '@santi020k/pawl'

export default [
  ...(await eslint({
    root: import.meta.dirname,
    plugins: { import: importPlugin }
  }))
  // Keep the existing project's resolver settings and framework configuration.
]
```

This binding does not declare two plugins equivalent. Every enabled rule that
uses the supplied namespace must have a callable implementation. Missing rules
are reported, and the `eslint()` helper rejects the configuration. Keep the
project's TypeScript resolver and host-specific settings; Pawl does not invent
resolver configuration or install a substitute plugin.

The lower-level helpers support the same controls:

- `eslintPlan({ root, policy, typescript, biomeActive, pluginRoots, plugins })`
- `eslintPlanFor(root, policy, { pluginRoots, plugins })`, with `undefined` as
  `policy` to load the project's policy from disk.

Plans retain `notEnforced` diagnostics. An entry with `required: true` means an
explicitly requested rule or pack, or a supplied plugin implementation, could not
run. Consumers that execute a plan directly must reject these entries as setup
failures. `eslint()` does this automatically; when ESLint runs through Pawl, the
failure is reported with exit code 2. Ordinary default coverage limitations
remain available for inspection without turning every optional plugin into a
required dependency. Disabled rules do not require an implementation.

### Framework and processor composition

Pass existing shared config through `baseConfig`, rather than appending it after
Pawl's returned array. Pawl preserves its parser, processor and resolver settings,
then reapplies locked policy levels after local exceptions:

```js
export default eslint({
  root: import.meta.dirname,
  baseConfig: sharedConfig
})
```

Astro physical files receive applicable locked rules without replacing their
Astro parser. Known Astro and Markdown virtual output (`**/*.astro/**`,
`**/*.md/**`, `**/*.mdx/**`) receives non-type-aware rules without a TypeScript
project. `untypedFiles` accepts only positive, relative, simple globs descending
below a non-JavaScript/TypeScript host filename, for example `**/*.vue/**`.
Broad physical patterns such as `**/*.ts`, exclusions, alternatives and path
traversal are rejected. Host filenames must have a nonempty stem. Each plan
checks actual directories, including ignored directories, and rejects collisions
such as a real `src/components.vue/` directory. Dependencies and Git internals
are excluded from this bounded directory-only scan; unreadable paths, external
directory links, cycles and exhausted limits fail closed.

A returned ESLint array is a configuration snapshot: regenerate it for each lint
run, including after changing the directory layout. Do not reuse a snapshot after
creating processor-shaped physical directories. Ordinary future physical `.ts`
files retain their locked type-aware rules. Generic typed
blocks from the shared config are split into physical and untyped virtual
counterparts. Type-aware rules are recognized through Pawl's catalog or plugin
metadata. Custom type-aware rules must expose `meta.docs.requiresTypeChecking`.
Missing locked plugin implementations remain setup failures.

Keep host-specific virtual import allowances in their existing framework blocks.
Pawl does not broaden them to ordinary JavaScript or TypeScript. The lock boundary
covers the composed array returned by Pawl; arbitrary blocks appended afterward
are outside that boundary. Use `baseConfig` for exceptions that must be checked.

### Test runners in a shared integration

Declare `testRunners` in policy to scope runner-specific rules consistently across
engines. For a shared ESLint integration that needs additional pack-specific file
ownership, pass `packFiles: { vitest: ['tests/unit/**'] }` to the helper. Unknown
packs and empty file lists are rejected. Pack scopes are relative to the explicit
project root; they do not change other engines' policy.

Playwright's own rule supports conditional project selection:

```js
options: {
  'playwright/no-skipped-test': [{ allowConditional: { skip: true } }],
}
```

With this explicit option, a callback such as
`test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium project')`
is accepted, while `test.skip('disabled', async () => {})` remains a finding.
The plugin also accepts literal `test.skip(true, ...)`; projects using this option
should retain a scoped `no-restricted-syntax` safeguard for their test binding:

```js
overrides: [
  {
    files: ['tests/browser/**'],
    rules: { 'no-restricted-syntax': 'error' },
    options: {
      'no-restricted-syntax': [
        {
          selector: "CallExpression[callee.object.name='test'][callee.property.name='skip'][arguments.0.value=true]",
          message: 'Use a project condition instead of permanently skipping this test.'
        }
      ]
    }
  }
]
```

Adjust the binding name if the project aliases `test`. Neither the plugin nor
this narrow safeguard proves that arbitrary computed conditions can become false;
project-selection behavior still needs the corresponding runner tests. Biome's
shared skipped-test check has no equivalent conditional option: retain the ESLint
rule for this integration and make any engine exception explicit and scoped.

## One import-sort owner

When Biome and ESLint run together, Pawl resolves ESLint's configuration for the
selected physical files before either engine can fix them. If Biome owns import
organization and ESLint enables `sort-imports`, `import/order`, `import-x/order`,
`simple-import-sort` import/export sorting or Perfectionist import/export sorting,
Pawl reports a blocking setup problem. Full checks and file-scoped hooks use the
same preflight.

Choose one owner. With the generated Biome configuration, disable only the
competing ESLint sorting rules. Retain semantic checks such as unresolved imports,
missing exports and dependency boundaries. Pawl never edits those rules for you.

For custom Biome inheritance or scoped source actions, ownership may be unknown.
Pawl then blocks competing ESLint sorting until you explicitly reconcile the
configurations. With only public Pawl preset inheritance, an explicit root
`assist.actions.source.organizeImports: "off"` lets ESLint own sorting; keep your custom configuration consistent with the policy
and review any drift reported by `doctor` or CI. Explicit global Biome exclusions are respected. Custom inheritance can re-enable
scoped source actions, so a root opt-out alone does not establish ownership there.
Complex scoped ownership is not inferred from a few sample files.

After reviewing the change, run `pawl fix`, `pawl check`, then `pawl fix` again.
The last command should make no diff. Repeat with the file list your Git hook
passes, and verify a deliberately invalid import still fails its semantic rule.
This preflight covers known import-sort owners; it does not claim that arbitrary
custom formatter plugins are equivalent or compatible.

## Mixed test runners

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

### Conditional Playwright projects

Biome 2.6.8's `noSkippedTests` rule has no option to distinguish conditional
Playwright project selection from an unconditional skip. Selecting explicit
Playwright scopes does not weaken that shared rule. When a supported Playwright
ESLint rule option provides the required semantics, use ESLint as the linter and
verify both the permitted conditional case and a genuinely skipped test. Keep
locked floors and the shared policy intact; selecting a different runner is not
permission to suppress skips.

### Engine boundaries

Pawl preserves each engine's coverage rather than claiming that all APIs have
identical support. In particular, Oxlint 1.94.0's Vitest skip check does not report
a `node:test` skip. Biome 2.6.8 does report that case. Keep the Node test runner's
own checks and required CI execution, and verify invalid fixtures for the engine
you select. `node` scopes record the assertion API ownership; they do not add a
new parser or a Pawl implementation of Node's test rules.

## Astro coverage boundaries

Pawl's `doctor` reports known Astro coverage limits under `Coverage`. JSON reports
include these messages in `limitations`, separate from `problems`. A limitation is
advisory: Pawl cannot tell whether your CI already runs the framework validator,
and it does not disable rules or change configuration in response.

### Keep framework validation

Run `astro check` and `astro build` alongside `pawl check` for each Astro application.
Biome 2.6.8 does not fully understand Astro's virtual modules, including
`astro:content` and `astro:transitions/client`, or the default exports of `.astro`
components. Its `correctness/noUnresolvedImports` rule can report these valid host
imports. Pawl retains the diagnostics rather than silently granting those module
names to unrelated projects.

Keep semantic import checks from your existing shared ESLint configuration when
it provides the required Astro parser and resolver. Validate both real framework
imports and an ordinary misspelled import before changing rule ownership. Do not
turn off unresolved-import checks across the repository or loosen locked rules
merely to remove the framework diagnostics. If a narrow exception is necessary,
review its exact host scope and retain the framework validator as a required gate.

### Scoped parser options are not equivalent

Biome 2.6.8 accepts `html.experimentalFullSupportEnabled` inside `overrides`, but
that does not reliably enable Astro template expression parsing. Pawl's real-engine
regression uses an invalid Astro expression that passes the scoped setting and
produces a parse error with the same option at the root.

A root-level opt-in changes the parser for the project; it is a separate decision,
not an automatic repair for scoped settings. Keep customized nested configurations
and a recoverable backup. Pawl continues to block nested Biome configuration whose
scopes cannot be preserved; it does not move these settings into an override and
claim equivalent validation. An accepted configuration or a clean `doctor` report
alone does not establish parser coverage.
