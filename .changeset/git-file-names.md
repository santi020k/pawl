---
"@santi020k/pawl": patch
---

Files with characters outside ASCII in their names, such as `café.ts`, are checked. Git quotes and escapes such a name when it lists files, so `--changed`, `--since`, pawl's own Docker and Markdown checks and the ratchet on disable comments never found the file.
