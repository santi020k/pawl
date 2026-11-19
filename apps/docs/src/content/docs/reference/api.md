---

title: API
description: Everything the CLI does is exported from @santi020k/pawl.
---

Everything the CLI does is exported, so other tools can build on it. The package is ESM and has no dependencies.

:::caution[Early]
The API may still change before the first release. The source of truth is [`src/index.ts`](https://github.com/santi020k/pawl/blob/main/packages/pawl/src/index.ts).
:::

## In config files

These two are the ones most projects touch.

```ts title="pawl.config.ts"
import { definePolicy } from '@santi020k/pawl'

export default definePolicy({ rules: { 'no-console': 'off' } })
```

```js title="eslint.config.js"
import { eslint } from '@santi020k/pawl'

export default eslint({ root: import.meta.dirname })
```

## Exports

| Area     | Exports                                                                                                                                                                    |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Check    | `check`, `exitCode`, `EXIT_OK`, `EXIT_FINDINGS`, `EXIT_SETUP`                                                                                                              |
| Setup    | `planInit`, `applyInit`, `planAdd`, `planPrettierConfig`, `recordBaseline`, `formatWritten`                                                                                |
| Migrate  | `planMigrate`, `describeMigration`, `MIGRATION_REPORT`                                                                                                                     |
| Detect   | `detect`, `describe`, `technologies`, `allTechnologies`, `packageTechnologies`, `needsEslint`, `usesReact`                                                                 |
| Policy   | `definePolicy`, `loadPolicy`, `resolvePolicy`, `mergeLayers`, `effectiveRules`, `defaultPolicy`, `DEFAULT_STYLE`                                                           |
| Rules    | `RULES`, `getRule`, `findRule`, `canonicalName`, `GATED_TAGS`                                                                                                              |
| Packs    | `PACKS`, `getPack`, `suggestedPacks`                                                                                                                                       |
| Baseline | `createBaseline`, `readBaseline`, `applyBaseline`, `scanSuppressions`, `BASELINE_FILE`                                                                                     |
| Output   | `format`, `formatPretty`, `formatAgent`, `formatJson`                                                                                                                      |
| Biome    | `biomeConfig`, `biomeProjectConfig`, `biomePackageConfig`, `biomeTechConfig`, `biomeTechPreset`, `checkBiomeConfig`, `BIOME_PRESET`, `BIOME_REACT_PRESET`, `BIOME_VERSION` |
| ESLint   | `eslint`, `eslintPlan`, `eslintPlanFor`                                                                                                                                    |
| Oxlint   | `oxlintConfig`, `oxlintCovers`, `checkOxlintConfig`, `OXLINT_RULES`, `OXLINT_VERSION`                                                                                      |
| Prettier | `prettierConfig`, `checkPrettierConfig`                                                                                                                                    |
| Doctor   | `doctor`, `formatDoctor`, `satisfies`                                                                                                                                      |
| Tools    | `toolset`                                                                                                                                                                  |
| Version  | `VERSION`                                                                                                                                                                  |

## Types

`Policy`, `PolicyInput`, `StyleOptions`, `Level`, `Finding`, `SetupIssue`, `LockViolation`, `EngineChoice`, `EngineName`, `FormatterChoice`, `FormatterName`, `CheckOptions`, `CheckResult`, `Baseline`, `BaselineResult`, `Suppression`, `Detection`, `DetectOptions`, `Detectable`, `FileFormat`, `Framework`, `Runtime`, `Override`, `OverrideInput`, `DoctorReport`, `Compatibility`, `JsonSchema`, `OxlintContext`, `PackageManager`, `WorkspaceTool`, `InitOptions`, `InitPlan`, `InitAction`, `InitMode`, `MigrateOptions`, `MigratePlan`, `RuleChange`, `OutputFormat`, `Pack`, `RuleDef`, `RuleTag`, `RuleContext`, `Technology`, `Toolset`, `BiomeContext`, `EslintOptions`, `EslintPlan`, `EslintPlanOptions`, `FlatConfig`.

## Biome presets

A project's `biome.json` extends the standard through the package's Biome entry points:

```json title="biome.json"
{ "extends": ["@santi020k/pawl/biome"] }
```

The policy's JSON schema is `@santi020k/pawl/schema.json`.

Technology presets live under `@santi020k/pawl/biome/<technology>`: `react`, `next`, `react-native`, `qwik`, `solid`, `vue`, `svelte`, `astro`, `tailwind`, `tanstack-query`, `drizzle`, `playwright` and `turbo`. See [Monorepos](/guide/monorepos/) for how `init` uses them.
