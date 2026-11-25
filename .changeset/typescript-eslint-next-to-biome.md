---
'@santi020k/pawl': patch
---

`pawl init` and `pawl add` install `typescript-eslint` in a TypeScript project also when ESLint runs next to Biome: for a Vue, Svelte or Astro project, which Biome does not fully lint, or for a pack. ESLint lints the scripts too, so without it every TypeScript file with a type in it failed with "Parsing error: Unexpected token": `init` recorded those in the baseline, a new typed file failed the check, and `pawl doctor` asked for `typescript-eslint` that nothing had installed.
