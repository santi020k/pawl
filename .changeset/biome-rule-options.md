---
"@santi020k/pawl": minor
---

The policy takes `biomeOptions`: rule options in Biome's own shape, by the same names as `rules`, at the top level and in `overrides`. They replace the options the standard gives a rule, and reach `biome:group/name` rules too. Until now only ESLint and Oxlint took options from the policy.
