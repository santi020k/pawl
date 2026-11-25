---
'@santi020k/pawl': patch
---

The oldest versions pawl declares for ESLint, `typescript-eslint` and the pack plugins are now ones that work with it. Each was found by running every pack against its plugin at that version, with ESLint at its own floor. `pawl doctor` reports an installed version below its floor as a problem, which also fails the doctor step of the workflow `init --workflow` writes. Run `pawl upgrade` to move it.

- ESLint is now `>=9.35.0`, up from `>=9.22.0`: the standard uses `no-unassigned-vars` and `preserve-caught-error`, which ESLint added in 9.27 and 9.35, so an older ESLint stopped because it could not find them.
- `typescript-eslint` is now `>=8.15.0`, up from `>=8.0.0`: older versions crash in `no-unused-expressions` under ESLint 9.35.
- Plugins that lacked rules the packs set, or did not load, have a higher floor: `@eslint-react/eslint-plugin` 4.2.1, `@darraghor/eslint-plugin-nestjs-typed` 7.4.0, `eslint-plugin-astro` 1.0.3 and `eslint-plugin-i18next` 6.1.0.
- The nine plugins that took any version now have a floor: `eslint-plugin-solid` 0.14.1, `eslint-plugin-lit` 1.12.0, `@tanstack/eslint-plugin-query` 5.43.1, `eslint-plugin-compat` 6.0.0, `eslint-plugin-depend` 1.0.0, `eslint-plugin-toml` 0.10.0, `@html-eslint/eslint-plugin` 0.41.0, `eslint-plugin-hono` 1.0.0 and `@tanstack/eslint-plugin-router` 1.58.0.
