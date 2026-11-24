---
"@santi020k/pawl": minor
---

Migrate scoped ESLint rules onto policies that already contain file overrides. Explicit source scopes replay after parent scopes, while locked rule floors remain enforced. Parent exceptions remain where the source does not override them; unsafe inherited option combinations still stop before any writes.
