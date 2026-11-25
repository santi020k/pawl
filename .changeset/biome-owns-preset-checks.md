---
'@santi020k/pawl': patch
---

Where Biome is the linter, a duplicate key in a `.json` or `.jsonc` file is reported once, by Biome. The JSON pack reported it again as `jsonc/no-dupe-keys`; it still checks `.json5` files, which Biome does not read. The same goes for the rules of a plugin's own preset that Biome or Oxlint enforces, which the Vue, Svelte, Astro and format packs left on: a one-word Vue component name was reported by both Biome and `vue/multi-word-component-names`. A rule the standard holds back in the fast linter as unstable keeps the level the plugin's preset gives it.
