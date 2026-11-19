---

title: Configuration
description: Every option of pawl.config.ts, its type, its default, and how layers merge.
---

This page lists every option. For what a policy is and how a company shares one, see [The policy](/guide/policy/).

## The config file

Pawl looks for one of these files in the directory it runs from, in this order, and uses the first it finds:

1. `pawl.config.ts`
2. `pawl.config.mts`
3. `pawl.config.js`
4. `pawl.config.mjs`
5. `pawl.config.json`

With none of them, the repo uses the default standard. Pawl reads no other place, such as a key in `package.json`.

A `.ts` or `.js` file must have a default export. `definePolicy` gives it types and returns the policy unchanged:

```ts title="pawl.config.ts"
import { definePolicy } from '@santi020k/pawl'

export default definePolicy({
  rules: { 'no-console': 'off' }
})
```

A `.json` file holds the same object, as plain JSON. It may name the schema pawl ships, so an editor completes and checks it:

```json title="pawl.config.json"
{
  "$schema": "./node_modules/@santi020k/pawl/pawl.config.schema.json",
  "rules": { "no-console": "off" }
}
```

The schema is also exported as `@santi020k/pawl/schema.json`. Pawl ignores `$schema` and refuses any other key it does not know, in this file and in every policy it extends, so a typo such as `ignores` stops the run with exit code 2 instead of passing in silence.

ESLint runs from wherever an editor starts it, so `eslint.config.js` passes its own folder as the root: `eslint({ root: import.meta.dirname })`. Without a root, pawl looks up from the working directory for the nearest folder with a pawl config, then the nearest with an ESLint flat config, then the nearest with a `package.json`.

After changing the policy, run `pawl sync` to rewrite the Biome, Oxlint and Prettier config files. ESLint reads the policy live, so it needs no sync.

## Options

| Option           | Type                                                            | Default   |
| ---------------- | --------------------------------------------------------------- | --------- |
| `extends`        | `string`, a policy, or a list of them                           | none      |
| `engine`         | `'auto'`, `'biome'`, `'oxlint'` or `'eslint'`                   | `'auto'`  |
| `formatter`      | `'auto'`, `'biome'` or `'prettier'`                             | `'auto'`  |
| `packs`          | `string[]`                                                      | `[]`      |
| `strict`         | `boolean`                                                       | `false`   |
| `maxWarnings`    | `number`, 0 or more                                             | none      |
| `style`          | Part of [the style](#style)                                     | See below |
| `rules`          | `Record<string, 'off' \| 'warn' \| 'error'>`                    | `{}`      |
| `options`        | `Record<string, unknown[]>`                                     | `{}`      |
| `overrides`      | `{ files: string[], rules?, options? }[]`                       | `[]`      |
| `locked`         | `string[]`                                                      | `[]`      |
| `ignore`         | `string[]`                                                      | `[]`      |
| `gitignore`      | `boolean`                                                       | `true`    |
| `defaultIgnores` | `boolean`                                                       | `true`    |
| `runtime`        | `'node'`, `'browser'`, `'bun'`, `'deno'`, `'worker'`, or a list | detected  |
| `detect`         | `boolean` or `{ exclude: string[] }`                            | `true`    |

### extends

Policies to build on. Each entry is a package name, a path relative to the config file, or an inline policy. They apply in order, and this file applies last.

A policy package must have a default export that is a policy, and must ship JavaScript. An `extends` chain more than 10 levels deep is an error, which usually means a cycle.

### engine

The linter. On `auto`, Biome lints, and ESLint runs next to it when the repo has a flat ESLint config (`eslint.config.js`, `.mjs`, `.ts`, `.mts` or `.cjs`).

`'biome'` means Biome only: ESLint does not run, even with a flat config. With `'oxlint'`, ESLint still runs next to Oxlint for the packs when the repo has a flat config. `'eslint'` makes ESLint the linter.

### formatter

The formatter. On `auto` it is Biome, unless the linter is not Biome and the repo has a Prettier config file; then it is Prettier.

### packs

Optional [packs](/guide/packs/) to switch on by name. Packs for what the project depends on switch on by themselves. A name such as `unicorn/recommended` starts the pack from the plugin's own preset.

### strict

Use the stricter level of every rule that has one. Rules Biome marks as unstable are on only when the policy is strict.

### maxWarnings

Fail the check, with exit code 1, when there are more new warnings than this. Warnings the baseline allows do not count. Without it, warnings never fail the check. A later layer can lower the limit but not raise it, and `pawl check --max-warnings <n>` can only lower it further.

### style

| Key              | Type                        | Default       |
| ---------------- | --------------------------- | ------------- |
| `indent`         | `2`, `4` or `'tab'`         | `2`           |
| `lineWidth`      | `number`                    | `120`         |
| `quotes`         | `'single'` or `'double'`    | `'single'`    |
| `semicolons`     | `boolean`                   | `false`       |
| `trailingCommas` | `'none'` or `'all'`         | `'none'`      |
| `arrowParens`    | `'as-needed'` or `'always'` | `'as-needed'` |

Set only the keys you want to change. The formatter in use applies the style.

### rules

Levels by rule name: `'off'`, `'warn'` or `'error'`.

- Names are ESLint's names, as in the [rules reference](/reference/rules/).
- An old name for the same check sets that check: `@typescript-eslint/no-unused-vars` sets `no-unused-vars`.
- `biome:group/name` reaches a rule only Biome has.
- `pawl/` names reach pawl's own checks, such as `pawl/docker-no-root` and the [guards](/guide/guards/).
- Any other name is passed to ESLint as it is.

### options

Rule options in ESLint's shape, by the same names as `rules`. ESLint and Oxlint take them. Biome ignores them and uses the options in pawl's catalog.

```ts
export default definePolicy({
  rules: { 'no-restricted-syntax': 'error' },
  options: { 'no-restricted-syntax': ['WithStatement'] }
})
```

### overrides

Levels and options for some files only. Each entry has `files`, a list of glob patterns, and `rules` and `options` in the same shape as the top level.

```ts
export default definePolicy({
  overrides: [{ files: ['*.test.ts'], rules: { '@typescript-eslint/no-explicit-any': 'off' } }]
})
```

- Biome gets an entry in its `overrides`, Oxlint one in its `overrides`, and ESLint a config entry after the base and the packs.
- In TypeScript files, a core rule's typescript-eslint twin follows it, as at the top level.
- An entry with `options` but no level for a rule gives the options to the rule at the level it has.
- Rules for a technology the project does not use are left out, as at the top level.
- A locked rule keeps its stricter level in an override too, and the attempt is reported.
- Pawl's own Docker checks follow the top-level levels only.

### locked

Rules that later layers may tighten but never loosen.

### ignore

Extra glob patterns to skip, on top of the defaults and the `.gitignore`. They apply at once, even before `pawl sync` has run. A pattern without a slash matches at any depth, as in `.gitignore`: `vendor` skips every folder named `vendor`, and `src/vendor` only that one.

### gitignore

Skip what the root `.gitignore` lists, including its `!` lines. Biome reads the file through its git integration, which pawl turns on in `biome.json` when there is a `.gitignore` or a git repo. Pawl turns the lines into ESLint's ignore patterns. Oxlint reads the file by itself, whatever this option says.

### defaultIgnores

Skip what no project wants checked: build output and caches (`dist`, `build`, `coverage`, `.turbo`, `.next`, `.open-next`, `.astro`, `.nuxt`, `.svelte-kit`, `.output`, `.vercel`, `.wrangler`), test reports (`playwright-report`, `test-results`), `*.tsbuildinfo`, lockfiles, the folders of AI coding tools (`.agent`, `.agents`, `.aider*`, `.claude`, `.clinerules`, `.codex`, `.copilot`, `.cursor`, `.gemini`, `.kiro`, `.opencode`, `.roo`, `.windsurf`) and generated code (`__generated__`, `*.generated.*`, `*.gen.*`, `.prisma`). `false` checks them. `node_modules`, `.git` and `.pawl` are always skipped.

### runtime

Where the code runs, instead of what pawl detects. Each runtime brings its global variables:

| Runtime   | Detected from                                                                    | Globals                                                |
| --------- | -------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `node`    | Any project with a `package.json`                                                | Node's                                                 |
| `browser` | A frontend framework, or no sign of any runtime                                  | The browser's                                          |
| `bun`     | `bun-types`, `@types/bun` or `bunfig.toml`                                       | Node's and `Bun`                                       |
| `deno`    | `deno.json` or `deno.jsonc`                                                      | The web platform's and `Deno`                          |
| `worker`  | `wrangler`, `@cloudflare/workers-types`, or `wrangler.toml`, `.json` or `.jsonc` | A service worker's, `HTMLRewriter` and `WebSocketPair` |

Biome knows the Node and browser globals by itself, so `biome.json` names only the rest in `javascript.globals`. Oxlint gets its own `env`, and ESLint the lists of the `globals` package when the project has it, else pawl's own.

### detect

Detection works out the frameworks and technologies from the dependencies and a shallow look at the files, and with them which technology rules apply. `false` turns it off: no technology rules apply and the runtimes are Node and the browser. `{ exclude: [...] }` leaves some out: any framework pawl detects, such as `'tailwind'` or `'next'`, or `'turbo'` for the Turborepo rules. Packs and guards still follow the dependencies either way.

## How layers merge

The default standard comes first, then each `extends` entry, then the config file. A later layer wins, with these rules:

| Option                                   | When two layers set it                                         |
| ---------------------------------------- | -------------------------------------------------------------- |
| `engine`, `formatter`                    | The later one wins                                             |
| `strict`                                 | Once on, it stays on                                           |
| `maxWarnings`                            | The lower limit wins                                           |
| `style`                                  | Keys merge; a later key wins                                   |
| `rules`                                  | A later level wins, unless the rule is locked and it is looser |
| `options`                                | A later entry replaces the earlier one for that rule           |
| `gitignore`, `defaultIgnores`, `runtime` | The later one wins                                             |
| `detect`                                 | A later `true` or `false` wins; the exclusions add up          |
| `packs`, `locked`, `ignore`, `overrides` | The lists add up                                               |

A looser level for a locked rule is ignored. The stricter level is kept, and `pawl check` and `pawl doctor` report the attempt. With `--ci`, that fails the check with exit code 2.
