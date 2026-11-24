---
'@santi020k/pawl': patch
---

Fix the packs whose plugin ships its preset as a whole flat config, such as Vue, Svelte, YAML, JSONC, TOML, Storybook and Astro 3: 0.5.0 stopped every check that used one of them with "Pawl cannot enforce requested ESLint rules", because it looked for the plugin only in the block that set the rule, and these presets register it in an earlier block. A block of such a preset that names no files now keeps to the pack's own files when it sets a parser, a language or a processor, so the HTML pack no longer parses the scripts as HTML, and to the scripts and the pack's own files otherwise, so Vue's rules no longer reach the Markdown, JSON or YAML that another pack hands to its own parser, where they crashed ESLint.
