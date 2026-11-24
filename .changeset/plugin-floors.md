---
'@santi020k/pawl': patch
---

The nine packs whose plugin took any version now name the oldest version that works with ESLint 9 and has the preset the pack starts from: `eslint-plugin-solid` 0.14.1, `eslint-plugin-lit` 1.12.0, `@tanstack/eslint-plugin-query` 5.43.1, `eslint-plugin-compat` 6.0.0, `eslint-plugin-depend` 1.0.0, `eslint-plugin-toml` 0.10.0, `@html-eslint/eslint-plugin` 0.41.0, `eslint-plugin-hono` 1.0.0 and `@tanstack/eslint-plugin-router` 1.58.0. Each was run against ESLint 9.22. `pawl doctor` now says when an installed plugin is older than that, where it used to accept any version.
