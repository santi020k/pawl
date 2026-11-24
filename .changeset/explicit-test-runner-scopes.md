---
"@santi020k/pawl": minor
---

Add explicit `testRunners` file scopes for mixed Vitest, Jest, Playwright and Node test projects. Runner-specific assertion conventions stay in their declared scopes while shared focused/skipped-test checks retain their floors. Reject empty, unknown or exclusion-based scopes and attempts to narrow locked runner rules. Document the pinned engines' conditional Playwright and Node skip coverage boundaries.
