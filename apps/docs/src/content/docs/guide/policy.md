---

title: The policy
description: "Set the lint standard for one repo in pawl.config.ts, or share one: extend @santi020k/pawl-policy or publish your own, with locked rules no repo can loosen."
head: [{ tag: title, content: "The policy: one lint standard for one repo or many | pawl" }]
---

A repo on the default standard needs no config file. To change something, add `pawl.config.ts`:

```ts title="pawl.config.ts"
import { definePolicy } from '@santi020k/pawl'

export default definePolicy({
  extends: '@santi020k/pawl-policy', // a shared policy package, see below
  rules: { 'no-console': 'off' },
  ignore: ['generated/**']
})
```

Then run `pawl sync`, which rewrites the engine config files from the policy. `pawl.config.js`, `.mjs` and `.json` work too. A JSON policy can name the schema pawl ships, so an editor completes and checks it:

```json title="pawl.config.json"
{
  "$schema": "./node_modules/@santi020k/pawl/pawl.config.schema.json",
  "rules": { "no-console": "off" }
}
```

## Options

| Option           | Meaning                                                                                        |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| `extends`        | Policies to build on: a package, a relative path, or an inline policy. Later ones win.         |
| `engine`         | The linter: `auto` (default), `biome`, `oxlint` or `eslint`.                                   |
| `formatter`      | `auto` (default), `biome` or `prettier`.                                                       |
| `strict`         | Use the stricter level of every rule that has one. A later layer cannot turn it off.           |
| `maxWarnings`    | Fail the check when there are more new warnings than this. A later layer can only lower it.    |
| `style`          | `indent`, `lineWidth`, `quotes`, `semicolons`, `trailingCommas`, `arrowParens`.                |
| `rules`          | Levels by rule name: `off`, `warn` or `error`.                                                 |
| `options`        | Options by rule name, in ESLint's shape. ESLint and Oxlint take them.                          |
| `biomeOptions`   | Options by rule name, in Biome's shape. Only Biome takes them.                                 |
| `overrides`      | Levels and options for some files only, such as tests.                                         |
| `packs`          | Optional packs to switch on. `unicorn/recommended` starts a pack from the plugin's own preset. |
| `locked`         | Rules that later layers may tighten but not loosen.                                            |
| `ignore`         | Extra glob patterns to skip.                                                                   |
| `gitignore`      | Skip what the root `.gitignore` lists. On by default.                                          |
| `defaultIgnores` | Skip build output, caches, lockfiles, AI tool folders and generated code. On by default.       |
| `runtime`        | Where the code runs: `node`, `browser`, `bun`, `deno` or `worker`. Replaces what pawl detects. |
| `detect`         | `false` turns detection off; `{ exclude: ['tailwind'] }` leaves a technology out.              |

Every option is listed in [Configuration](/reference/config/). An option pawl does not know, such as `ignores` for `ignore`, stops the run with an error, so a typo never passes in silence.

## Rule names

Rule names are ESLint's names. Use `biome:group/name` for a rule only Biome has. Any other name pawl does not know is passed to ESLint.

```ts
export default definePolicy({
  rules: { 'no-restricted-syntax': 'error' },
  options: { 'no-restricted-syntax': ['WithStatement'] }
})
```

An old name for the same check works too: `@typescript-eslint/no-unused-vars` sets `no-unused-vars`. Run `pawl explain <rule>` to see a rule's level in your repo and which engine rule enforces it.

## Style

The default style is 2 spaces, single quotes, no semicolons, no trailing commas and a line width of 120. Change any of it under `style`; the formatter you use applies it.

## Overrides

Set levels and options for some files only. Each entry names its files and takes `rules` and `options` like the top level:

```ts
export default definePolicy({
  overrides: [
    { files: ['*.test.ts', 'test/**'], rules: { 'no-console': 'off', '@typescript-eslint/no-explicit-any': 'off' } },
    { files: ['scripts/**'], options: { 'no-console': [{ allow: ['log'] }] } }
  ]
})
```

Pawl writes them into each engine's own overrides: Biome's `overrides`, Oxlint's `overrides`, and ESLint config entries after the rest. A later entry wins over an earlier one. A pattern without a slash matches at any depth, as in `.gitignore`. Options with no level go with the level the rule already has.

A locked rule cannot be loosened for some files either: the stricter level is kept and the attempt is reported.

## What pawl skips

Every engine skips the same files:

- **The defaults**: build output (`dist`, `build`, `coverage`, `.next`, `.vercel`, `.wrangler` and the like), test reports, `*.tsbuildinfo`, lockfiles, the folders AI coding tools keep for themselves (`.claude`, `.cursor`, `.codex` and others), and generated code (`__generated__`, `*.generated.*`, `*.gen.*`, `.prisma`). Set `defaultIgnores: false` to check them.
- **The root `.gitignore`**: Biome reads it through its git integration, pawl turns it into ESLint's ignore patterns, and Oxlint reads it by itself. Set `gitignore: false` to check what git ignores. Oxlint always reads it.
- **Your `ignore` list**, on top of both.

`node_modules`, `.git` and `.pawl` are always skipped.

## Runtimes and detection

Pawl works out where the code runs and gives each linter the global variables of those runtimes: `node`, `browser`, `bun` (from `bun-types` or `bunfig.toml`), `deno` (from `deno.json`) and `worker` (Cloudflare Workers, from `wrangler` or a `wrangler.toml`). A frontend framework means the browser, and a server framework such as NestJS or Hono, without a frontend one, means no browser. A project with no sign of where it runs gets Node and the browser. Name the runtimes yourself to replace what pawl found:

```ts
export default definePolicy({ runtime: ['node', 'bun'] })
```

Detection also decides which technology rules apply. Leave one out, or turn detection off and keep only what the policy names:

```ts
export default definePolicy({ detect: { exclude: ['tailwind'] } })
```

With `detect: false`, no technology rules apply and the runtimes are Node and the browser. Packs and guards still follow the dependencies the project installs.

## A shared policy

A policy can live in an npm package, so many repos share one standard. The package's default export is a policy, and each repo installs it as a dev dependency and names it in `extends`.

### A real one: `@santi020k/pawl-policy`

[`@santi020k/pawl-policy`](https://www.npmjs.com/package/@santi020k/pawl-policy) is the policy Santiago Molina uses on his own projects. It turns on `strict`, makes more correctness rules fail instead of warn, and locks the rules that matter most:

```js title="@santi020k/pawl-policy/index.js"
export default {
  strict: true,
  rules: {
    'no-shadow': 'error',
    'no-param-reassign': 'error',
    'prefer-promise-reject-errors': 'error'
    // ...
  },
  locked: [
    'eqeqeq',
    '@typescript-eslint/no-explicit-any',
    '@typescript-eslint/ban-ts-comment'
    // ...
  ]
}
```

[The whole file](https://github.com/santi020k/pawl/blob/main/packages/pawl-policy/index.js) is short. Use it as it is, or read it as an example of a policy package:

```sh
npm install --save-dev @santi020k/pawl-policy
```

Repos extend it. A repo can still tighten any rule, but an attempt to loosen a locked one is ignored and reported by `pawl check` and `pawl doctor`.

### Your own

It is a personal policy, and it changes when its author's standard does. For a team or a company, fork it, or publish your own package under your own scope, such as `@acme/pawl-policy`. It can be public or private; pawl only needs to resolve it from the repo.

```js title="@acme/pawl-policy/index.js"
export default {
  extends: '@santi020k/pawl-policy', // optional: start from it, then change what you need
  rules: { 'no-console': 'error' },
  locked: ['no-console']
}
```

:::note
Policy packages must ship JavaScript, because Node does not run TypeScript from `node_modules`.
:::
