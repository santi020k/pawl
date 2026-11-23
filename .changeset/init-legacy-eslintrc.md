---
"@santi020k/pawl": patch
---

`pawl init` handles a repo whose only ESLint config is a legacy `.eslintrc`. With `--mode keep` or `--engine eslint` it now writes the `eslint.config.js` that ESLint needs; it used to pin ESLint as the linter with no flat config, so every check stopped with ESLint's "couldn't find an eslint.config file". In the default mode it no longer lists ESLint as a linter that runs, and its note points to `pawl migrate`, the way to carry that file's rules into a policy. `pawl add` writes the flat config in the same situation.
