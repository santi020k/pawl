---
"@santi020k/pawl": minor
---

`pawl explain` knows the names pawl gives a finding: its own, such as `pawl/sort-package-json` and `eslint:parse`, and those of an engine's own rules, such as `biome:style/noDefaultExport`, which it links to the engine's page for. `pawl explain pawl/ai-keys` shows what a guard refuses, the level it runs at and whether it is on in the project, and `pawl explain pawl/sort-package-json` says how to fix that one. These names used to get "not in the pawl catalog" and exit code 1, though pawl's own output had printed them.
