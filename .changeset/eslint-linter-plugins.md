---
'@santi020k/pawl': patch
---

`pawl init --engine eslint` installs every plugin the standard needs when ESLint is the linter, so `pawl doctor` finds none missing after it. It installed ESLint, `@eslint/js` and `typescript-eslint` only, and the doctor then exited with code 2 for the rules Biome would have run: those of `eslint-plugin-unicorn`, `eslint-plugin-promise`, `eslint-plugin-unused-imports`, `eslint-plugin-import`, `eslint-plugin-no-only-tests` and `@vitest/eslint-plugin`. `init`, and `pawl add` in a project that ESLint lints, now install each plugin the doctor would ask for, and with `--no-install` write them into `devDependencies`, a pack's plugin from its floor. Under npm they go in last, in a command of their own, so that a plugin whose peer range npm refuses, as `eslint-plugin-import`'s leaves out ESLint 10, does not stop pawl and ESLint from installing.
