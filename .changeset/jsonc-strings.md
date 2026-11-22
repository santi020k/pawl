---
"@santi020k/pawl": patch
---

When pawl merges into a JSON file that has trailing commas, such as `.vscode/settings.json`, the strings in it stay as they are. A value such as `**/*.{js,}` or `[,]]` used to lose its comma when the file was written back.
