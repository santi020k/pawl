---

## '@santi020k/pawl': minor

Cover more of the eslint-config-basic rules without a plugin.

- 24 new catalog rules. 8 are enforced by Biome (6 of them only under `strict`, as Biome marks them unstable) and 16 by Oxlint, such as `unicorn/prefer-spread`, `promise/always-return` and `vitest/valid-expect`. With Biome as the linter, a rule Biome has no equivalent for does not make ESLint ask for a plugin; it runs when the plugin's pack is on or the policy names it.
- Four more aliases: `@typescript-eslint/no-unused-expressions`, `regexp/no-useless-escape`, `n/no-extraneous-import` and `n/no-missing-import`.
- New guards: `zod`, `testing-library`, `testing-library-debug`, `testing-library-dom` and `nuxt`. The matching pack rules are now off, so nothing is reported twice.
- Markdown checks of pawl's own: `pawl/markdown-no-empty-links` (error), and `pawl/markdown-no-duplicate-headings` and `pawl/markdown-no-missing-label-refs` (off by default).
- `pawl explain` now names the Oxlint rule, and explains the Markdown checks.
- The unicorn, promise, vitest, vue, yaml, markdown and TypeScript packs no longer set the levels of rules that moved into the catalog. `@typescript-eslint/await-thenable` is now only on under `strict` under ESLint too.
