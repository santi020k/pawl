---
"@santi020k/pawl": patch
---

A file that Prettier cannot parse is now a finding on that file, `prettier:parse`, with the line and column Prettier names, instead of a setup problem that stopped the whole check. The other files are still checked, and the ones that are not formatted are still reported. A broken Prettier config, an unknown option or a crash of Prettier is still a setup problem. `pawl explain prettier:parse` says what it means.
