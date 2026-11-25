---
'@santi020k/pawl': patch
---

With ESLint as the linter, the standard's rules for scripts reach the scripts of `.vue`, `.svelte` and `.astro` files, through the parser the Vue, Svelte and Astro packs set up. A `debugger`, a `var` or an `==` in a `<script setup>` or an Astro frontmatter passed the check before. In a TypeScript project typescript-eslint's rules run there as in a `.ts` file, except the ones that need type information, since a component has no TypeScript program; policy overrides and locked rules reach those scripts the same way. Where Biome is the linter, the rules it enforces stay Biome's there too.
