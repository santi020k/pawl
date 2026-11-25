---
'@santi020k/pawl': patch
---

The packs whose plugin ships its preset as a flat config of several blocks work again: Vue, Svelte, YAML, JSONC, TOML, Storybook and Astro 3. In 0.5.0, every check with one of them stopped with "Pawl cannot enforce requested ESLint rules".

- Pawl looked for a rule's plugin only in the block that set the rule, and these presets register the plugin in an earlier block. It now looks in every block, as ESLint does.
- A block of a pack's preset that names no files keeps to the pack's own files when it sets a parser, a language or a processor, so the HTML pack no longer parses scripts as HTML. A block with rules only keeps to the scripts and the pack's own files, so Vue's rules no longer reach the Markdown, JSON or YAML that another pack parses, where they crashed ESLint.
- A pack registers the plugin object its preset registers, so a plugin whose ES module build exports another object than its presets use, such as `eslint-plugin-astro` 1.x, no longer stops ESLint with "Cannot redefine plugin".
