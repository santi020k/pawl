---
"@santi020k/pawl": patch
---

When a project's `biome.json` extends `@santi020k/pawl/biome` and pawl is not in the project's `node_modules`, `pawl check` says so with the new `pawl-missing` setup problem, and `pawl doctor` lists it. Before, the check showed Biome's own "Failed to resolve the configuration" error and the doctor found no problem. This is what a run through `npx` alone, or a fresh clone before its install, looks like.
