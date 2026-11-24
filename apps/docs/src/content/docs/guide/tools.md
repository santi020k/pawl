---

title: Choosing tools
description: "Lint with Biome, Oxlint or ESLint and format with Biome or Prettier. Pawl compiles one rule standard for the engine in use and reports what it cannot enforce."
head: [{ tag: title, content: "Choosing tools: Biome, Oxlint, ESLint or Prettier | pawl" }]
---

Pawl has no dependencies. Every tool is an optional peer, and `init` installs the ones you pick.

The choices below cover JavaScript and TypeScript. For Rust, Swift and Kotlin, [enable native-language checks](/guide/languages/) explicitly: those languages use their own installed tools and project configuration, with Pawl's shared policy levels, baseline and report.

| Job    | Choices                 | Default on auto |
| ------ | ----------------------- | --------------- |
| Lint   | Biome, Oxlint or ESLint | Biome           |
| Format | Biome or Prettier       | Biome           |

Biome is the default because it lints and formats in one binary. ESLint and Prettier are equal choices.

## Which tool should I choose?

| Choose   | When it fits                                                                                        | What to check                                                                               |
| -------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Biome    | You want one tool for linting and formatting, with Pawl's default setup.                            | Check the [component support notes](#biome) if you use Vue, Svelte or Astro.                |
| Oxlint   | You already use Oxlint or want it to enforce Pawl's standard while choosing a formatter separately. | Type-aware rules need `oxlint-tsgolint` in the root project. See [Oxlint's setup](#oxlint). |
| ESLint   | You want ESLint to enforce the standard and run your optional plugin packs.                         | Install the plugins for the [packs](/guide/packs/) you enable.                              |
| Prettier | You want to keep Prettier as your formatter alongside any of the linters.                           | Select it with `--formatter prettier`; it does not replace the linter.                      |

Packs can also run in ESLint alongside Biome or Oxlint. After choosing, run `pawl doctor` to see which rules your installed tools can enforce before relying on the check in [CI](/guide/ci/).

## Picking

```sh
pawl init                                      # ask, or use auto without a terminal
pawl init --engine eslint --formatter prettier # say it up front
```

Or in the [policy](/guide/policy/): `engine: 'eslint'`, `formatter: 'prettier'`. Any mix works: Biome can lint while Prettier formats, and ESLint can lint while Biome formats.

## One standard for every engine

The standard has 201 rules. They are named once, with ESLint's names, and pawl compiles them for the engine in use. Every finding still shows the engine's own rule name, so `biome check` and `eslint .` keep working on their own with the same config files.

```txt
$ pawl explain eqeqeq
eqeqeq
  Use === and !==.

  Level here:  error (default standard)
  Biome:       suspicious/noDoubleEquals  https://biomejs.dev/linter/rules/no-double-equals
  Oxlint:      eqeqeq
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

Oxlint enforces 162 of the standard's 201 rules under their ESLint names. It refuses a config that names a rule it does not have, so pawl writes `.oxlintrc.json` in full and keeps it in step with `pawl sync`. Nine more rules of the standard need type information, such as `@typescript-eslint/no-floating-promises`. Oxlint runs them through the separate `oxlint-tsgolint` package. `pawl init` adds it to the devDependencies of a TypeScript project that lints with Oxlint. When the root `package.json` depends on it (Oxlint runs at the root, so a workspace package's copy does not count), pawl writes those rules and `"options": { "typeAware": true }` into `.oxlintrc.json`. Findings carry the standard's names, such as `@typescript-eslint/no-floating-promises`, in the baseline and the agent format, and `pawl explain` takes Oxlint's own name, `typescript/no-floating-promises`, too. The config follows `package.json`, as it does for every other tool, so it does not change when the install runs; until it has, `pawl check` stops with a setup problem and exit code 2 rather than skip the rules. Without the package, pawl leaves them out, because Oxlint fails when a type-aware rule has no tsgolint to run it, and `pawl doctor` names the package to install. `pawl sync` adds or removes the option as the dependency comes and goes. tsgolint brings its own TypeScript compiler, so it does not depend on the project's `typescript` version, and it reads the project's `tsconfig.json` when there is one.

Oxlint skips `node_modules` only where a `.gitignore` lists it, so pawl names the folder in `.oxlintrc.json` itself. For Vue, Svelte and Astro projects pawl also declares the names the compiler gives a component, such as `defineProps`, `$state` and `Astro`, so `no-undef` does not report them.

### ESLint

ESLint is the host for every optional [pack](/guide/packs/). The config stays one line:

```js title="eslint.config.js"
import { eslint } from '@santi020k/pawl'

export default eslint({ root: import.meta.dirname })
```

## When an engine cannot enforce a rule

A missing rule is reported, never papered over. `pawl doctor` lists what the engine in use cannot enforce, and pawl does not install a second engine silently.
