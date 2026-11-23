---
"@santi020k/pawl": patch
---

Run the engines of `pawl check` at the same time instead of one after another. Results are reported in the same order as before, and exit codes are unchanged. `pawl fix` keeps running engines one at a time, because they may edit the same files.
