---

title: Packs
description: Optional sets of ESLint rules for what only a plugin can check. Pawl holds the rules; your project installs the plugin.
---

A pack is a set of ESLint rules for one plugin. For libraries that need no plugin, see [Guards](/guide/guards/). Pawl ships each pack as data, its rules and levels, and your project installs the plugin. There are 50, each checked against its real plugin.

```sh
pawl add zod testing-library   # installs eslint and the plugins, writes eslint.config.js if needed
pawl doctor                    # shows which packs are active
```

## The packs

| Kind                                   | Packs                                                                                                                             |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Base, on whenever ESLint is the linter | `javascript`, `typescript`                                                                                                        |
| Frameworks                             | `react-hooks`, `preact`, `next`, `angular`, `nest`, `hono`, `vue`, `svelte`, `astro`, `astro-doctor`, `solid`, `lit`, `stencil`   |
| Testing                                | `vitest`, `jest`, `jest-dom`, `testing-library`, `playwright`, `cypress`, `storybook`                                             |
| Libraries                              | `zod`, `tanstack-query`, `tanstack-router`, `i18next`, `ai`, `tailwind`, `graphql`, `graphql-schema`, `swagger`                   |
| Rule packs                             | `unicorn`, `regexp`, `node`, `promise`, `perfectionist`, `jsdoc`, `security`, `sonarjs`, `jsx-a11y`, `compat`, `depend`, `cspell` |
| Formats                                | `yaml`, `jsonc`, `markdown`, `toml`, `html`, `package-json`, `pnpm`                                                               |

## How packs switch on

- A pack for something your project depends on switches on as soon as its plugin is installed. `init` tells you which ones fit.
- The rule packs and formats are opt-in: `pawl add` records them under `packs` in the policy.
- A pack starts from the plugin's own recommended rules, then applies the standard's levels, then your policy's `rules`.
- Where Biome is the linter, it keeps the rules it already enforces, so nothing is reported twice.
- A rule the installed plugin does not have is left out and listed by `pawl doctor`, so an older plugin does not break the run.

## Starting from a plugin's preset

`unicorn/recommended` in `packs` starts the unicorn pack from the plugin's own recommended preset. Any pack takes a preset name this way.

```ts title="pawl.config.ts"
import { definePolicy } from '@santi020k/pawl'

export default definePolicy({
  packs: ['unicorn/recommended', 'regexp']
})
```

## Running next to Biome

An optional pack runs through ESLint next to Biome, or with ESLint as the only linter. The ESLint config stays one line:

```js title="eslint.config.js"
import { eslint } from '@santi020k/pawl'

export default eslint()
```
