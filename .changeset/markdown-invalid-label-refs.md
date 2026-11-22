---
"@santi020k/pawl": minor
---

A new Markdown check, `pawl/markdown-no-invalid-label-refs`, finds a reference with only whitespace between its second brackets, such as `[text][ ]`, which CommonMark does not read as a reference. It is an error by default, like the rule of the same name in `@eslint/markdown`, and skips code blocks, code spans, HTML comments and front matter. The rule is off in the `markdown` pack, so nothing is reported twice.
