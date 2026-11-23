---
"@santi020k/pawl": patch
---

Run the engines of `pawl check` at the same time instead of one after another. Results are still reported in registry order and exit codes are unchanged. `pawl fix` keeps running engines one at a time, because they may edit the same files.
