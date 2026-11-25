---
'@santi020k/pawl': patch
---

`pawl check`, `pawl fix` and `pawl baseline` work from a package folder of a monorepo, or from any folder below the root such as `src`. Pawl looked for its config in the folder it started in, so in a package it said "No biome.json found. Run pawl init" while the root had one, and `pawl baseline` would have written a second baseline there. It now runs from the nearest folder above, in the same git repository, that has pawl's policy, its baseline or an engine config, as at the root, and takes the files you name from the folder you are in: `pawl check .` checks that package only. The hooks of coding agents started in a package do the same.
