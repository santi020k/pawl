---
'@santi020k/pawl': patch
---

The Vue and Svelte packs read `<script lang="ts">` in a TypeScript project: they hand each component's script to typescript-eslint's parser. Their presets leave it to espree, so every component with a type in it failed the check with "Parsing error: Unexpected token".
