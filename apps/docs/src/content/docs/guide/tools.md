---

title: Choosing tools
description: Lint with Biome, Oxlint or ESLint, format with Biome or Prettier. One standard either way.
---

Pawl has no dependencies. Every tool is an optional peer, and `init` installs the ones you pick.

| Job    | Choices                 | Default on auto |
| ------ | ----------------------- | --------------- |
| Lint   | Biome, Oxlint or ESLint | Biome           |
| Format | Biome or Prettier       | Biome           |

Biome is the default because it lints and formats in one binary. ESLint and Prettier are equal choices.

## Picking

```sh
pawl init                                      # ask, or use auto without a terminal
pawl init --engine eslint --formatter prettier # say it up front
```

Or in the [policy](/guide/policy/): `engine: 'eslint'`, `formatter: 'prettier'`. Any mix works: Biome can lint while Prettier formats, and ESLint can lint while Biome formats.

## One standard for every engine

The standard has 200 rules. They are named once, with ESLint's names, and pawl compiles them for the engine in use. Every finding still shows the engine's own rule name, so `biome check` and `eslint .` keep working on their own with the same config files.

```txt
$ pawl explain eqeqeq
eqeqeq
  Use === and !==.

  Level here:  error (default standard)
  Biome:       suspicious/noDoubleEquals  https://biomejs.dev/linter/rules/no-double-equals
  ESLint:      eqeqeq
```

- Rules for React, Qwik, Vue, Svelte and Turborepo apply only where that technology is used.
- For each technology a project uses, pawl also turns on the rules Biome itself recommends for it: React, Next.js, React Native, Qwik, Solid, Vue, Svelte, Astro, Tailwind CSS, TanStack Query, Drizzle, Playwright and Turborepo.
- Rules Biome still marks as unstable are off unless the policy is `strict`.

The full list is in the [rules reference](/reference/rules/).

## Engine notes

### Biome

A project's `biome.json` extends `@santi020k/pawl/biome` and holds only what its policy changes.

Biome is pinned to one exact version, because pawl reads a report format Biome may change between releases.

In a `.vue`, `.svelte` or `.astro` file Biome reads the script and not the template. Four rules judge a name by how the script alone uses it, so the standard switches them off for those files, as Biome's own guide does: `no-unused-vars`, `unused-imports/no-unused-imports`, `prefer-const` and `@typescript-eslint/consistent-type-imports`. Left on, they report an import the template uses as unused, and the fix for a type-only import turns a value the template needs into `import type`. A policy that has switched on Biome's full support for these files can have them back with an entry in [`overrides`](/reference/config/#overrides).

### Oxlint

Oxlint enforces 162 of the standard's 200 rules under their ESLint names. It refuses a config that names a rule it does not have, so pawl writes `.oxlintrc.json` in full and keeps it in step with `pawl sync`. Its type-aware rules are not driven by pawl yet.

Oxlint skips `node_modules` only where a `.gitignore` lists it, so pawl names the folder in `.oxlintrc.json` itself. For Vue, Svelte and Astro projects pawl also declares the names the compiler gives a component, such as `defineProps`, `$state` and `Astro`, so `no-undef` does not report them.

### ESLint

ESLint is the host for every optional [pack](/guide/packs/). The config stays one line:

```js title="eslint.config.js"
import { eslint } from '@santi020k/pawl'

export default eslint({ root: import.meta.dirname })
```

## When an engine cannot enforce a rule

A missing rule is reported, never papered over. `pawl doctor` lists what the engine in use cannot enforce, and pawl does not install a second engine silently.
