---
'@santi020k/pawl': patch
---

With Prettier as the formatter, `pawl fix` no longer rewrites the files pawl skips. Prettier reads only `.gitignore` and `.prettierignore`, so the policy's `ignore` and pawl's default ignores, such as `.changeset` and the build folders, never reached it: `pawl check` hid the findings, but `pawl fix` formatted those files anyway. Pawl now passes them to Prettier as negative patterns.
