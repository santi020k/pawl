---
'@santi020k/pawl': patch
---

`pawl add` and `pawl init --packs` install `typescript-eslint` in a TypeScript project also when ESLint runs only for the packs, next to Biome. ESLint lints the scripts for every pack, so without it `pawl add yaml` or `pawl add markdown` made every TypeScript file with a type in it fail the check with "Parsing error: Unexpected token", and `pawl doctor` asked for `typescript-eslint` that nothing had installed.
