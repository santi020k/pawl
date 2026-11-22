---
"@santi020k/pawl": patch
---

`pawl fix` no longer breaks Vue and Astro components. Biome reads the script of a `.vue`, `.svelte` or `.astro` file and not its template, so it took an import the template uses as a value for a type-only one, and its fix rewrote it to `import type`. It also reported names the template uses as unused. The standard now switches off the four rules that judge a name by the script alone in those files, as Biome's own guide does: `no-unused-vars`, `unused-imports/no-unused-imports`, `prefer-const` and `@typescript-eslint/consistent-type-imports`. A policy can switch them back on with an override. With Oxlint, the names a framework's compiler gives a component, such as `defineProps`, `$state` and `Astro`, are no longer reported by `no-undef`; run `pawl sync` to write them into `.oxlintrc.json`.
