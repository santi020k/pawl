---
"@santi020k/pawl": patch
---

Detection finds every config file name ESLint reads: `eslint.config.cts` and `.eslintrc.yaml` were missed, so a repo with one of them was not seen as using ESLint. When a repo has more than one, pawl now picks the one ESLint itself would read.
