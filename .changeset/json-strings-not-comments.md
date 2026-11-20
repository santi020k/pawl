---
'@santi020k/pawl': patch
---

The ratchet no longer counts a JSON string that shows a disable comment, such as a snippet in `.vscode/*.json`, as a comment that switches a check off. Real comments in JSONC files, such as `tsconfig.json`, still count.
