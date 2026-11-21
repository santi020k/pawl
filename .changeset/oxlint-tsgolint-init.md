---
'@santi020k/pawl': minor
---

`pawl init` adds `oxlint-tsgolint` to TypeScript projects that lint with Oxlint, so the rules of the standard that need type information run there too. Type-aware mode now follows `package.json`, as every other tool does, so `.oxlintrc.json` does not change when the install runs. When the package is declared but not installed, `pawl check` stops with the `tsgolint-missing` setup problem and exit code 2, and `pawl doctor` says to install the dependencies. Only the root `package.json` counts, because Oxlint runs at the root and looks for tsgolint from there: when only a workspace package declares it, `pawl doctor` says to add it to the root's devDependencies.
