---
"@santi020k/pawl": minor
---

With Oxlint as the linter, pawl now drives the rules that need type information, such as `@typescript-eslint/no-floating-promises`, when the project depends on `oxlint-tsgolint`. It writes those rules, for TypeScript files only as in ESLint, and `options.typeAware` into `.oxlintrc.json`, and `pawl sync` adds or removes them as the dependency comes and goes. Without the package, pawl leaves them out and `pawl doctor` asks for it. `oxlint-tsgolint` is a new optional peer dependency. ESLint beside Oxlint no longer takes a rule that Oxlint runs with it.
