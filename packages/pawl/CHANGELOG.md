# @santi020k/pawl

## 0.1.0

### Minor Changes

- First public release of pawl: one standard for Biome, Oxlint, ESLint and Prettier, with guards for AI SDKs, Docker and Markdown checks, optional packs, a ratchet baseline and agent-friendly output.
- Covers the rules of `@santi020k/eslint-config-basic` without a plugin wherever Biome or Oxlint has one, with guards for Zod, Testing Library and Nuxt, and Markdown checks of pawl's own.
- The policy takes path-scoped `overrides`, a `runtime`, `detect`, `gitignore`, `defaultIgnores` and `maxWarnings`, and refuses unknown keys. A JSON schema ships as `@santi020k/pawl/schema.json`.
- Every engine and pawl's own checks share one ignore list and follow `.gitignore`.
- `pawl doctor --format json` reports the setup and checks Node, Biome and plugin versions; `pawl check --max-warnings <n>` fails on too many warnings.
