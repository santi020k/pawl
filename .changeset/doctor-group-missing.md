---
"@santi020k/pawl": patch
---

`pawl doctor` names a missing ESLint plugin once, with the first rules that wait on it and a count of the rest. It printed one problem for every rule, so a project that lints with ESLint and has none of the plugins installed got some forty lines that hid the other problems. `--format json` still lists every rule under `engines.eslint.notEnforced`.
