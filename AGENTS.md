# Working in this repo

Pawl is a TypeScript library and CLI in `packages/pawl`. The website and docs are in `apps/docs`: Astro Starlight for the doc pages, Lumen UI for the landing page and custom components. See `apps/docs/README.md`.

## Commands

```sh
pnpm install
pnpm build && pnpm test   # tests run against the real Biome and ESLint
pnpm typecheck
pnpm check                # pawl checking its own code; must stay clean
pnpm fix
pnpm ok                   # the full gate: also cspell, knip and the generated-files check
pnpm changeset            # every user-visible change to @santi020k/pawl needs one
```

Quality (`quality.yml`) runs `pnpm ok` as the repository check and owns the Git hooks. Quality 2.1 treats this repo as managed by pawl, so it leaves the engines to pawl; its Biome adapter is enabled only for `quality format` and `quality fix`. Keep `pnpm ok` the canonical gate. Commit messages are validated by Commitprompt.

## Layout

`packages/pawl/src` is grouped by layer, lowest first. A module imports from its own layer or a lower one, never from a higher one, and there are no import cycles; `test/architecture.test.ts` checks both.

| Folder     | What it holds                                                                                                                                                                                                                           |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `utils/`   | JSON, file, list, text, semver and terminal helpers (colors, symbols, widths). No pawl concepts.                                                                                                                                        |
| `catalog/` | The product as data: rules, packs, guards, runtimes. No disk access.                                                                                                                                                                    |
| `project/` | Detection, config file names, the files git sees, ignores and the toolset.                                                                                                                                                              |
| `scans/`   | Pawl's own line scans and their rules, behind `scan.ts` and a registry. The policy reads their levels.                                                                                                                                  |
| `policy/`  | Merging the layers (`merge.ts`), loading the files (`load.ts`), the level of each rule (`levels.ts`), and `loadProject` (`project.ts`): the policy with the project it applies to.                                                      |
| `engines/` | One folder per engine: `config.ts` (what its config should be), `run.ts` (run it and read its report) and `engine.ts` (its `Engine` adapter). `registry.ts` lists them.                                                                 |
| `check/`   | The check, its result and exit codes, the baseline and the output formats.                                                                                                                                                              |
| `report/`  | The doctor and `explain`.                                                                                                                                                                                                               |
| `setup/`   | One planner per command (`init`, `add`, `sync`, `migrate/`) and the steps they share. Plans only read the disk; `applyPlan` writes.                                                                                                     |
| `cli/`     | Options, printing and one module per command. `audience.ts` tells a person from a coding agent; `ui.ts` and `prompt.ts` draw the rail, spinners and questions a person sees. `src/cli.ts` is the entry point and the table of commands. |

`src/types.ts` and `src/version.ts` are shared by every layer and import none of them.

A new engine is an `Engine` in `engines/<name>/engine.ts`, added to `engines/registry.ts`: the check and the doctor pick it up from there. The tools of the other languages (Clippy, rustfmt, SwiftLint, SwiftFormat, swift-format, ktlint) are not `Engine`s: they are programs on the `PATH` that run once per project folder with the project's own config, so they live in `engines/languages/`, one module per toolchain behind `tool.ts`, and `check.ts` there runs them for the check and reports them to the doctor. The languages themselves, and how their projects are found, are in `project/languages.ts`. A rule only one engine has is named `biome:`, `oxlint:` or `eslint:` through `scopedName` and `scopedRule` in `catalog/rules.ts`.

## Rules of the codebase

- Zero dependencies. Every engine, formatter and ESLint plugin is an optional peer. Use Node built-ins.
- A pack in `src/catalog/packs.ts` is data only. Never import a plugin from pawl; load it from the project.
- Source imports use the `.ts` extension. Only erasable TypeScript syntax: no enums, no parameter properties.
- The rule catalog in `src/catalog/rules.ts` is the product. A test checks every Biome mapping against the pinned Biome schema.
- After changing a rule, the style or the Biome version, run `pnpm --filter @santi020k/pawl run preset` and `pnpm --filter @santi020k/pawl run docs:rules`, and commit the results.
- A rule for one technology (React, Qwik, Vue, Svelte, Turborepo) gets that technology's tag, so it only applies where the technology is used.
- Pawl reads Biome's JSON reporter, which Biome calls experimental. That is why the Biome version is pinned exactly; recheck `runBiome` in `src/engines/biome/run.ts` on every Biome upgrade.
- After upgrading Oxlint or oxlint-tsgolint, or changing a rule's aliases, run `pnpm --filter @santi020k/pawl run oxlint-rules`. Oxlint rejects a config that names a rule it does not know, and `pnpm run check:generated` fails when the list is out of date.
- Pawl never deletes or overwrites a user's existing tool config. `migrate` is the one exception to overwriting: it moves the old ESLint config aside under a new name first.
- The policy carries rule options in two shapes. `options` is ESLint's shape and goes to ESLint and Oxlint only. `biomeOptions` is Biome's shape and goes to Biome only, where it replaces the options the catalog gives the rule. Never translate one shape into the other.
- A guard in `src/catalog/guards.ts` is data only: imports and code patterns to refuse for one library. Every entry needs a message that says what to do instead. A code pattern has two forms that must match the same code: an ESLint selector and a GritQL pattern, which pawl writes into the project's `.pawl/rules/` for Biome. Test both against the real engines.
- The Docker checks in `src/scans/docker.ts` and the Markdown checks in `src/scans/markdown.ts` are the only rules pawl implements itself as line scans, because no engine reads those files. Keep each one a plain line scan that skips what is not prose or instructions, with a test for a file that is wrong and one that is fine. They honour the same ignores as the engines (`src/project/ignores.ts`).
- A new pack needs its plugin as an optional peer in `packages/pawl/package.json`, and a run against the real plugin before it ships.
- Every engine failure must reach the user as a setup problem with exit code 2. Never report success when part of the check did not run.
- Output has three readers. A person at a terminal gets the rich view (`terminal().rich`): symbols, code frames, the rail, colors where allowed. Coding agents, pipes and logs get plain text that stays the same from run to run; an agent's `check` and `fix` default to `--format agent`. Editors read `--format editor`. Spin only when `terminal().animate` says so and ask only when `terminal().interactive` does, so nothing waits for an answer nobody can give.
- Pawl has no standard of its own for Rust, Swift or Kotlin. A language runs only when the policy names it in `languages`, with the project's own config; pawl applies the policy's levels to what the tool reports, by the tool's rule name (`clippy:needless_return`). A tool that is not installed is `language-tool-missing`, a blocking setup problem.
- Do not name a file `biome.json` anywhere but a project root: Biome treats each one as a nested configuration.

<!-- commitprompt:start -->
## Commit generation

- Inspect the repository instructions, status, staged diff, and unstaged diff
  before proposing a commit message.
- Do not stage files unless the user explicitly asks you to.
- Run `commitprompt types --json`, `commitprompt scopes --json`, and
  `commitprompt instructions --json` to load the repository rules.
- Pass all six structured fields to `commitprompt format --json`, then validate
  the exact message with `commitprompt validate --json`.
- Only run `commitprompt commit --yes --json` when the user explicitly
  authorizes a commit. Never stage unrelated files or bypass Git hooks.
- Review messages generated by Zed or VS Code. The `commit-msg` hook is the
  final authority and rejected messages must be corrected, not forced through.
<!-- commitprompt:end -->
