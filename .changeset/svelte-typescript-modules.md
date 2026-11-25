---
'@santi020k/pawl': patch
---

The Svelte pack reads `.svelte.ts` modules in a TypeScript project. eslint-plugin-svelte hands those files to its own parser, which read their script as JavaScript, so every module with a type in it failed the check with "Parsing error: Unexpected token :". It now gets typescript-eslint's parser, as the `<script lang="ts">` of a component does, and keeps the rules that need type information.
