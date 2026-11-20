---
"@santi020k/pawl": patch
---

In a policy's `ignore` and in the `files` of an override, `[` and `]` are the characters themselves, so `src/app/[slug]` names that route folder in every engine. Before, Biome refused the whole config, and ESLint and Oxlint read the brackets as a character class. A `.gitignore` line with a leading slash, such as `/build`, skips only that path at the root, as git reads it; pawl's own checks and ESLint used to skip every `build` folder. Character classes in `.gitignore` lines, such as `*.py[cod]`, are read too.
