---
"@santi020k/pawl": patch
---

A rule the policy names for Oxlint only, such as `oxlint:no-foo`, no longer reaches ESLint's config, where ESLint refused it as a rule it does not know. ESLint already left `biome:` names alone; it now does the same for every engine's own names.
