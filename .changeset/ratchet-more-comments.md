---
"@santi020k/pawl": minor
---

The ratchet on disable comments counts Oxlint's own, `oxlint-disable`, `oxlint-disable-line` and `oxlint-disable-next-line`, which got past it until now. It also reads the stylesheets, JSON and GraphQL files Biome lints, and the YAML and TOML files an ESLint pack lints, where a `biome-ignore` or `eslint-disable` comment switched a check off unseen. A repo that already has such comments sees them once as new: run `pawl baseline` after upgrading to record them.
