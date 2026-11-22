---
"@santi020k/pawl": patch
---

Five rules of the standard are marked as needing type information, as typescript-eslint defines them: `consistent-type-exports`, `no-deprecated`, `no-unnecessary-type-assertion`, `no-unsafe-return` and `prefer-nullish-coalescing`. ESLint loads type information only when an active rule needs it, so a policy that switched `prefer-optional-chain` off while one of these stayed on gave ESLint a rule it cannot run without types. A test now checks the mark against the rule list of the pinned Oxlint.
