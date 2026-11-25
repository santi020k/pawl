---
'@santi020k/pawl': patch
---

With ESLint as the linter, the standard's `vitest/*` rules apply only in a project that tests with Vitest: one that depends on `vitest`, or whose policy declares it in `testRunners`. In a project that tests with Jest or `node:test`, they asked for `@vitest/eslint-plugin`, which `init` and `add` then installed, and under npm that install failed in a TypeScript 5 project, outside the plugin's peer range. A policy that names a `vitest/*` rule still gets it.
