---
"@santi020k/pawl": minor
---

The Zod guard also refuses `.describe()` in place of `.meta()`, and `z.union()` of string `z.literal()` values in place of `z.enum()`. The Testing Library guard also refuses queries taken from `render()` in place of `screen`, and a new guard, `testing-library-find-by`, warns about `waitFor()` around a `getBy` or `queryBy` query. They need no plugin and run in Biome, Oxlint's imports aside, and in ESLint. The matching `eslint-plugin-zod` and `eslint-plugin-testing-library` rules are off in the packs, so nothing is reported twice.
