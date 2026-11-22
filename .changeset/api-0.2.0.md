---
"@santi020k/pawl": minor
---

The API adds `loadProject`, which loads the policy, detects the project and works out its tools in one call, and `explainRule`, which returns what `pawl explain` prints for a rule.

Breaking: `usesReact` and `BIOME_REACT_PRESET` are removed. Use `technologies(detection).includes('react')` and `biomeTechPreset('react')`.
