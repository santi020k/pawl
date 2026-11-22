# @santi020k/pawl-policy

Santiago Molina's [pawl](https://pawl.santi020k.com) policy, used on his own projects. It is pawl's default standard, made stricter:

- **`strict: true`**, the stricter level of every rule that has one, including the type-aware promise rules.
- **More rules fail instead of warning**: `no-shadow`, `no-param-reassign`, `no-fallthrough`, `array-callback-return`, `prefer-promise-reject-errors` and other checks that catch bugs more often than style.
- **No new warnings**: `maxWarnings: 0`, so a warning fails the check like an error does.
- **Room for scripts**: files under `scripts/` and `bin/` may use the console. `func-style` stays off.
- **Locked rules** that a repo can tighten but never loosen: no `any`, no non-null assertions, no `@ts-ignore`, no `eval`, no `var`, `===` only, no unused imports and no `.only` in tests.

Every rule it names is in pawl's catalog, so it means the same on Biome, Oxlint and ESLint.

## Use it

```sh
npm install --save-dev @santi020k/pawl @santi020k/pawl-policy
```

```ts title="pawl.config.ts"
import { definePolicy } from '@santi020k/pawl'

export default definePolicy({
  extends: '@santi020k/pawl-policy'
})
```

Then run `pawl sync`. A repo can still change anything that is not locked. An attempt to loosen a locked rule is ignored, and `pawl check` and `pawl doctor` report it.

## Your own policy

This is a personal policy, and it changes when Santiago's standard does. For a team or a company, fork it, or copy [`index.js`](./index.js) into a package under your own scope, such as `@acme/pawl-policy`, and publish that. The [policy guide](https://pawl.santi020k.com/guide/policy/) lists every option.

## License

MIT
