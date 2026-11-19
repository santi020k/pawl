---

title: The policy
description: Change the standard for a repo, or publish one for a whole company.
---

A repo on the default standard needs no config file. To change something, add `pawl.config.ts`:

```ts title="pawl.config.ts"
import { definePolicy } from '@santi020k/pawl'

export default definePolicy({
  extends: '@acme/pawl-policy', // your company's shared policy package, see below
  strict: true,
  rules: { 'no-console': 'off' },
  ignore: ['generated/**']
})
```

Then run `pawl sync`, which rewrites the engine config files from the policy. `pawl.config.js`, `.mjs` and `.json` work too.

## Options

| Option      | Meaning                                                                                        |
| ----------- | ---------------------------------------------------------------------------------------------- |
| `extends`   | Policies to build on: a package, a relative path, or an inline policy. Later ones win.         |
| `engine`    | The linter: `auto` (default), `biome`, `oxlint` or `eslint`.                                   |
| `formatter` | `auto` (default), `biome` or `prettier`.                                                       |
| `strict`    | Use the stricter level of every rule that has one. A later layer cannot turn it off.           |
| `style`     | `indent`, `lineWidth`, `quotes`, `semicolons`, `trailingCommas`, `arrowParens`.                |
| `rules`     | Levels by rule name: `off`, `warn` or `error`.                                                 |
| `options`   | Options by rule name, in ESLint's shape. ESLint and Oxlint take them; Biome uses pawl's own.   |
| `packs`     | Optional packs to switch on. `unicorn/recommended` starts a pack from the plugin's own preset. |
| `locked`    | Rules that later layers may tighten but not loosen.                                            |
| `ignore`    | Extra glob patterns to skip.                                                                   |

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

## A company standard

Publish a package whose default export is a policy. In these examples it is called `@acme/pawl-policy`: `@acme` stands for your company's npm scope, and the name is up to you. It is an ordinary package, public or private, that every repo installs as a dev dependency and names in `extends`.

```js title="@acme/pawl-policy/index.js"
export default {
  strict: true,
  rules: { 'no-console': 'error' },
  locked: ['no-console', '@typescript-eslint/no-explicit-any']
}
```

Repos extend it. A repo can still tighten any rule, but an attempt to loosen a locked one is ignored and reported by `pawl check` and `pawl doctor`.

:::note
Policy packages must ship JavaScript, because Node does not run TypeScript from `node_modules`.
:::
