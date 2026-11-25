---
'@santi020k/pawl': patch
---

Where Biome or Oxlint is the linter and the policy names the `javascript` or `typescript` pack, as `pawl migrate` writes it, ESLint leaves off the rules the linter already enforces. It ran them at the level the plugin's preset gave them, so `pawl check` reported a `debugger` or an unused variable twice, and a rule the policy turned off, such as `@typescript-eslint/no-non-null-assertion` after a migration, still failed under ESLint.
