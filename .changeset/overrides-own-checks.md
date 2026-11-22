---
"@santi020k/pawl": minor
---

An override sets the level of pawl's own Docker and Markdown checks for the files it names, as it does for the rules an engine runs. Those checks used to read only the top-level `rules`, so `pawl/markdown-no-duplicate-headings` could not be switched off for a changelog alone.
