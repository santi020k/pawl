---
'@santi020k/pawl': patch
---

With ESLint as the linter in a TypeScript project, `pawl.config.ts` parses when the `tsconfig.json` leaves it out, as the Vite and Svelte templates do. typescript-eslint's project service could not find it, so the check reported `eslint:parse` on the file `init` had just written, and `init` recorded it in the baseline. The config files of pawl, ESLint and Oxlint written in TypeScript now get the standard's rules without type information, whether or not a tsconfig includes them.
