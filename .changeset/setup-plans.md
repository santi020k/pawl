---
"@santi020k/pawl": minor
---

The setup API has one shape for every command. `planInit`, `planAdd`, the new `planSync` and `planMigrate` return plans of `SetupAction`s, and `applyPlan` writes any of them. `pawl sync` itself is built on `planSync`.

Breaking: `applyInit` is now `applyPlan`, the `InitAction` type is now `SetupAction`, `planAdd` returns a `SetupPlan` (it no longer carries init's `mode`, `engines` and `formatter`), and `planPrettierConfig` is no longer exported: use `planSync`.
