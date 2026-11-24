---

title: Shared ESLint plugins
description: Resolve shared-config plugins through public Pawl helpers without copying implementations.
---

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

## Framework and processor composition

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

## Mixed test runners

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
