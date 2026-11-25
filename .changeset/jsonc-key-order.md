---
'@santi020k/pawl': patch
---

The JSON pack no longer sorts keys. With `jsonc/sort-keys` on, `pawl fix` rewrote the keys of `package.json`, `tsconfig.json` and the `.vscode/tasks.json` pawl writes in alphabetical order, away from the order people and tools read them in. Turn the rule on in an override for the files where the order means nothing, such as `{ files: ['src/locales/**/*.json'], rules: { 'jsonc/sort-keys': 'warn' } }`.
