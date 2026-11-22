---
"@santi020k/pawl": minor
---

The Zod guard also refuses `z.union()` of string `z.literal()` values in place of `z.enum()`, and a new opt-in guard, `zod-meta`, refuses `.describe()` in place of Zod 4's `.meta()`: `pawl add zod-meta`. It is not on by itself because Zod 3, and the tool schemas of the AI SDK, write `.describe()`. The Testing Library guard also refuses queries taken from `render()` in place of `screen`, and a new guard, `testing-library-find-by`, warns about `waitFor()` around a `getBy` or `queryBy` query. They need no plugin and run in Biome, Oxlint's imports aside, and in ESLint. The matching `eslint-plugin-zod` and `eslint-plugin-testing-library` rules are off in the packs, so nothing is reported twice.
