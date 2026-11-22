---
"@santi020k/pawl": minor
---

`pawl doctor` reports the same setup problems as `pawl check`. A package's `biome.json`, or one of pawl's own Biome rule files, that is missing or out of date now shows up in the doctor too, and a missing engine or a loosened locked rule reads the same in both. A project that uses Biome without having it installed gets the new blocking `biome-missing` setup problem instead of `engine-failed`. In `pawl doctor --format json`, ESLint now comes before Prettier, the order the engines run in.
