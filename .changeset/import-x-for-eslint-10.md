---
'@santi020k/pawl': patch
---

With ESLint as the linter, the standard's `import/*` rules run with `eslint-plugin-import-x` in a project that does not have `eslint-plugin-import`, and `init` and `add` install it. `eslint-plugin-import` leaves ESLint 10 out of its peer range, so under npm `pawl init --engine eslint` failed at its plugin install with ERESOLVE. A project that already has `eslint-plugin-import` keeps using it. Pawl checks that the plugin in use implements each rule it runs: a rule it lacks is listed by `pawl doctor` instead of stopping ESLint with "Could not find rule".
