---
'@santi020k/pawl': minor
---

Expose shared plugin resolution roots and explicit plugin namespace bindings through all ESLint helpers. Validate requested plugin rule implementations and reject missing requested rules or packs as setup failures instead of silently omitting them. Keep ordinary default coverage limitations in the planner report.

Resolve import-only public package roots and concrete subpath exports in declaration order, including package self references. Denied exports no longer fall back to package main or private entries; unsupported pattern exports produce an actionable error.
