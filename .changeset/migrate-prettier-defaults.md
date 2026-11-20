---
"@santi020k/pawl": patch
---

`pawl migrate` keeps the format of a project that uses Prettier. An option the Prettier config leaves out is read from `.editorconfig`, as Prettier's command line reads it, and otherwise counts as what Prettier does by itself: double quotes, semicolons, trailing commas, 80 columns and parentheses around a single arrow parameter. Until now only the options written down were carried over, so a project on Prettier's defaults was reformatted to the standard's style by its first `pawl fix`. A `.prettierrc` with comments is read, and a Prettier config pawl cannot read, such as `prettier.config.js`, is reported in a note.
