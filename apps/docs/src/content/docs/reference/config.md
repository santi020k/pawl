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

A `.json` file holds the same object, as plain JSON.

After changing the policy, run `pawl sync` to rewrite the Biome, Oxlint and Prettier config files. ESLint reads the policy live, so it needs no sync.

## Options

| Option      | Type                                          | Default   |
| ----------- | --------------------------------------------- | --------- |
| `extends`   | `string`, a policy, or a list of them         | none      |
| `engine`    | `'auto'`, `'biome'`, `'oxlint'` or `'eslint'` | `'auto'`  |
| `formatter` | `'auto'`, `'biome'` or `'prettier'`           | `'auto'`  |
| `packs`     | `string[]`                                    | `[]`      |
| `strict`    | `boolean`                                     | `false`   |
| `style`     | Part of [the style](#style)                   | See below |
| `rules`     | `Record<string, 'off' \| 'warn' \| 'error'>`  | `{}`      |
| `options`   | `Record<string, unknown[]>`                   | `{}`      |
| `locked`    | `string[]`                                    | `[]`      |
| `ignore`    | `string[]`                                    | `[]`      |

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

### locked

Rules that later layers may tighten but never loosen.

### ignore

Extra glob patterns to skip. They apply at once, even before `pawl sync` has run.

## How layers merge

The default standard comes first, then each `extends` entry, then the config file. A later layer wins, with these rules:

| Option                      | When two layers set it                                         |
| --------------------------- | -------------------------------------------------------------- |
| `engine`, `formatter`       | The later one wins                                             |
| `strict`                    | Once on, it stays on                                           |
| `style`                     | Keys merge; a later key wins                                   |
| `rules`                     | A later level wins, unless the rule is locked and it is looser |
| `options`                   | A later entry replaces the earlier one for that rule           |
| `packs`, `locked`, `ignore` | The lists add up                                               |

A looser level for a locked rule is ignored. The stricter level is kept, and `pawl check` and `pawl doctor` report the attempt. With `--ci`, that fails the check with exit code 2.
