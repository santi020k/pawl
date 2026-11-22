---
"@santi020k/pawl": minor
---

The `typescript` pack now starts from typescript-eslint's `strictTypeChecked` and `stylisticTypeChecked` presets instead of `recommended`. Where ESLint lints TypeScript, promises nobody awaits, `any` that reaches typed code and assertions that change nothing are now errors. Rules the catalog holds back because Biome's version is unstable keep the level their ESLint preset gives them, unless the policy sets one. To go back to a rule's old level, set it in `rules`.

The default ignores now also cover `.build`, `.swiftpm`, `.pnpm-store`, `next-env.d.ts`, `worker-configuration.d.ts`, `cloudflare-env.d.ts` and `CHANGELOG.md`.
