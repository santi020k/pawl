---
'@santi020k/pawl': patch
---

`pawl add` and `pawl init` with `--no-install` write a version range for the Solid, TOML and HTML plugins that a package manager can install. They wrote `^0.0.0`, from the major version of the plugin's floor, which no version of those plugins satisfies, so the next install failed. The range of a pack's plugin now starts at its floor, such as `^0.14.1` for `eslint-plugin-solid` and `^4.2.1` for `@eslint-react/eslint-plugin`, and `typescript-eslint` is written as `^8.15.0`, the floor pawl declares, instead of `^8.0.0`.
