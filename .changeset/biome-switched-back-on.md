---
'@santi020k/pawl': patch
---

A project that moves its linting or formatting back to Biome, from Oxlint, ESLint or Prettier, is checked again. Pawl had written `"enabled": false` for Biome's linter or formatter into biome.json, and kept it after the policy changed back, while `pawl doctor` said biome.json was in line with the policy: Biome then linted or formatted nothing, and the check passed. A biome.json that switches off what the policy has Biome do is now out of date, `biome-config-stale`, and `pawl sync` switches it on again.
