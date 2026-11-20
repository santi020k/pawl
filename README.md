# pawl

Fast guardrails for AI-written code. One standard, for the linter and formatter you choose.

A pawl is the part of a ratchet that stops it slipping backward. This tool does the same for a codebase: existing findings are recorded once, and from then on quality can only move forward.

> **Status: early.** The library works and is tested, and the API may still change before 1.0.

## What it does

- **One command to set up a repo.** `pawl init` detects the stack and the tools already in use, then writes small config files that point at the standard.
- **Your tools.** Lint with Biome, Oxlint or ESLint, format with Biome or Prettier. Every tool is an optional peer; `init` installs the ones you pick, and Biome is the default when you leave it on auto.
- **One standard for every engine.** Rules are named once, using ESLint's names, and compiled for the engine in use.
- **Guards.** For the libraries a project uses (the AI SDKs, LangChain, MCP, Hono and others), pawl refuses imports of package internals, legacy SDKs, API keys written in the code and `dangerouslyAllowBrowser`. No plugin and no ESLint: the import rules run in Biome, Oxlint or ESLint, and the code patterns run in Biome as rules pawl writes itself, or in ESLint.
- **Docker checks.** 17 checks of pawl's own for Dockerfiles and Compose files: unpinned images, secrets, running as root, privileged services and more.
- **Optional packs.** 50 packs cover what only an ESLint plugin can check. Pawl holds the rules; the project installs the plugin.
- **A ratchet.** Existing findings go into a baseline. New findings fail the check, and so do new comments that switch a check off.
- **Output for coding agents.** `pawl check --changed --format agent` prints one compact JSON line per finding, with the fix.
- **A shared standard.** A team publishes one policy package, like [`@santi020k/pawl-policy`](packages/pawl-policy). Repos extend it, and the company can lock rules so repos cannot loosen them.
- **Engines stay visible.** `biome check` and `eslint .` keep working on their own, and every finding shows the engine's own rule name.

## Usage

```sh
npx @santi020k/pawl init   # once per repo
pawl check                 # lint, check formatting, apply the ratchet
pawl fix                   # apply safe fixes and format
```

See [packages/pawl/README.md](packages/pawl/README.md) for the full reference.

## This repository

| Path                   | What it is                                                                   |
| ---------------------- | ---------------------------------------------------------------------------- |
| `packages/pawl`        | The library and CLI, published as `@santi020k/pawl`                          |
| `packages/pawl-policy` | Santiago Molina's strict policy, published as `@santi020k/pawl-policy`       |
| `apps/docs`            | The website and docs for pawl.santi020k.com (Astro Starlight, with Lumen UI) |

It is a pnpm workspace run with Turborepo, and it lints itself with pawl.

```sh
pnpm install
pnpm build        # compile the library
pnpm test         # unit and end-to-end tests, against the real Biome and ESLint
pnpm typecheck
pnpm check        # pawl checking its own code
pnpm fix
pnpm ok           # everything above plus spelling, unused code and generated files, as CI runs it
pnpm hooks:install  # Git hooks from quality.yml (needs the Quality CLI)
pnpm commit       # a Conventional Commit, through Commitprompt
pnpm changeset    # record a user-visible change for the next release
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the release process and [SECURITY.md](SECURITY.md) to report a vulnerability.

After changing a rule or the style, regenerate the Biome presets and the rules page of the docs:

```sh
pnpm --filter @santi020k/pawl run preset
pnpm --filter @santi020k/pawl run docs:rules
```

Requires Node 22.18 or later.

## Design decisions

- **TypeScript, zero dependencies.** Every engine, formatter and plugin is an optional peer that the project installs.
- **Biome by default, not by force.** It lints and formats in one binary, so it is what auto picks. ESLint and Prettier are equal choices.
- **ESLint's rule names are the vocabulary.** `biome:group/name` reaches a Biome-only rule; any other unknown name is passed to ESLint.
- **Thin config files.** A project's `biome.json` extends `@santi020k/pawl/biome` and holds only what its policy changes.
- **Rules follow the technology.** React, Qwik, Vue, Svelte and Turborepo rules ship as separate presets. In a monorepo each package gets only the ones it uses.
- **A missing rule is reported, never papered over.** `pawl doctor` lists what an engine cannot enforce. Pawl does not install a second engine silently.
- **The baseline counts findings per file and rule, not per line,** so it survives edits and merges.

## Migration goal

The goal is that a project on `@santi020k/eslint-config-basic` can move to pawl and keep its checks, while choosing its own tools.

Pawl works in two layers:

- **The standard**, which Biome or ESLint enforces. Nothing to install beyond the engine the project picks.
- **Optional packs**, for what only an ESLint plugin can check. Pawl ships each pack as data: its rules and levels. The project installs the plugin, and the pack switches on.

Pawl does not depend on eslint-config-basic. The packs' rules and levels were carried over from it.

Status on 2026-11-18, checked against eslint-config-basic 3.6, Biome 2.6.8 and ESLint 10. "Rule domain" means Biome groups its own rules for that technology under a domain. "Biome's ... rules" means pawl turns that domain on with the rules Biome recommends. "Optional pack" means `pawl add <pack>` installs the plugin and switches it on.

### Engines

| Engine       | eslint-config-basic                                                              | Pawl                                                                                            |
| ------------ | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| ESLint       | The engine                                                                       | A linter you can choose, and the host for every optional pack                                   |
| Biome        | Compatibility only: turns off overlapping ESLint rules                           | The default linter and formatter when you leave the choice to pawl                              |
| Oxlint       | Compatibility only: turns off overlapping ESLint rules                           | A linter you can choose. It enforces 162 of the 200 rules; ESLint can host the packs next to it |
| Prettier     | Compatibility only                                                               | A formatter you can choose                                                                      |
| TypeScript 7 | TypeScript files cannot be linted: typescript-eslint 8.73 does not load under it | Works through Biome, which does not use the compiler                                            |

### Rules

The old config set 260 rules itself. Rules it inherited from plugin presets are not counted here.

| Source in eslint-config-basic          | Rules it set | In pawl | In pawl, strict only | In pawl, by Oxlint or pawl itself | Replaced by the formatter | Not in pawl yet |
| -------------------------------------- | -----------: | ------: | -------------------: | --------------------------------: | ------------------------: | --------------: |
| Core (ESLint core, stylistic, imports) |           66 |      24 |                    3 |                                 4 |                        29 |               6 |
| TypeScript                             |           32 |      18 |                    7 |                                 0 |                         1 |               6 |
| Unicorn                                |           26 |      12 |                    4 |                                 8 |                         0 |               2 |
| Astro                                  |           11 |       3 |                    0 |                                 0 |                         6 |               2 |
| Qwik                                   |           12 |      10 |                    0 |                                 0 |                         1 |               1 |
| Markdown                               |           10 |       0 |                    2 |                                 3 |                         1 |               4 |
| Vue                                    |            9 |       2 |                    4 |                                 1 |                         1 |               1 |
| Vitest                                 |            9 |       6 |                    0 |                                 3 |                         0 |               0 |
| Stencil                                |           18 |       0 |                    0 |                                 0 |                         0 |              18 |
| Zod                                    |            9 |       0 |                    0 |                                 5 |                         0 |               4 |
| Testing Library                        |            7 |       0 |                    0 |                                 3 |                         0 |               4 |
| Angular                                |            6 |       0 |                    0 |                                 0 |                         0 |               6 |
| Everything else                        |           45 |      12 |                    6 |                                 1 |                         2 |              24 |
| **Total**                              |      **260** |  **87** |               **26** |                            **28** |                    **41** |          **78** |

- "In pawl" means Biome enforces it with no plugin, under its own name or as an alias.
- "Strict only" rules are ones Biome still marks as unstable.
- "By Oxlint or pawl itself" means Oxlint enforces it and Biome has no equivalent (16 rules), or a guard or a Markdown check of pawl's own does (12). Oxlint still marks one of the 16, `import/export`, as unstable, so it too is on only under strict.
- Of the 78 not in pawl yet, 18 were left out on purpose.

The rule-by-rule list is in [docs/rules-from-eslint-config-basic.md](docs/rules-from-eslint-config-basic.md). Pawl also has rules the old config did not set: the catalog holds 200.

### Frameworks

| Framework             | eslint-config-basic | Pawl detects it | Pawl rules through Biome                         | Biome 2.6.8                                         | Through ESLint                                |
| --------------------- | ------------------- | --------------- | ------------------------------------------------ | --------------------------------------------------- | --------------------------------------------- |
| React                 | Package             | Yes             | 13, plus Biome's React rules                     | Rule domain                                         | Optional pack (`react-hooks`)                 |
| Next.js               | Package             | Yes             | The React rules, plus Biome's Next.js rules      | Rule domain                                         | Optional pack                                 |
| Expo and React Native | Package (Expo)      | Yes             | The React rules, plus Biome's React Native rules | Rule domain (React Native)                          | No                                            |
| Preact                | Package             | No              | None                                             | None                                                | No pack yet                                   |
| React Router          | Package             | As React        | The React rules                                  | None of its own                                     | No                                            |
| Remix                 | Package             | As React        | The React rules                                  | None of its own                                     | No                                            |
| TanStack Start        | Package             | As React        | The React rules                                  | None of its own                                     | No                                            |
| Qwik                  | Package             | Yes             | 9, plus Biome's Qwik rules                       | Rule domain                                         | No                                            |
| Solid                 | Package             | Yes             | Biome's Solid rules                              | Rule domain                                         | Optional pack                                 |
| Vue                   | Package             | Yes             | 5 (4 strict only), plus Biome's Vue rules        | Rule domain; full `.vue` support is experimental    | Optional pack                                 |
| Nuxt                  | Package             | Yes             | The Vue rules                                    | None for Nuxt itself                                | Optional pack (Vue)                           |
| Svelte                | Package             | Yes             | 2 (strict only), plus Biome's Svelte rules       | Rule domain; full `.svelte` support is experimental | Optional pack                                 |
| Astro                 | Package             | Yes             | Biome's Astro rules                              | Rule domain; full `.astro` support is experimental  | Optional pack                                 |
| Angular               | Package             | Yes             | None                                             | None                                                | Optional pack                                 |
| Lit                   | Package             | No              | None                                             | None                                                | Optional pack                                 |
| Nest                  | Package             | No              | None                                             | None                                                | Optional pack                                 |
| Hono                  | Package             | No              | Import guard                                     | Import guard                                        | Optional pack (`hono`) and code-pattern guard |
| Vite                  | Package             | No              | None                                             | None                                                | No pack: it only set file patterns            |
| Slidev                | Package             | No              | None                                             | None                                                | No pack: it only set file patterns            |

An optional pack runs through ESLint next to Biome, or with ESLint as the only linter. Biome keeps the rules it already enforces, so nothing is reported twice.

### Languages and formats

| Format                      | eslint-config-basic                | Pawl through Biome                                         |
| --------------------------- | ---------------------------------- | ---------------------------------------------------------- |
| JavaScript, TypeScript, JSX | Lint, and style through lint rules | Lint and format                                            |
| JSON, JSONC, `package.json` | Lint                               | Lint and format through Biome; more with the optional pack |
| CSS                         | Lint                               | Lint and format                                            |
| GraphQL                     | Lint                               | Lint and format                                            |
| YAML                        | Lint                               | Format through Biome; lint with the optional pack          |
| Markdown                    | Lint                               | Format through Biome; lint with the optional pack          |
| HTML                        | Lint                               | Experimental in Biome; lint with the optional pack         |
| MDX                         | Lint                               | Not verified                                               |
| TOML                        | Lint                               | Lint with the optional pack                                |

### Testing

| Tool            | eslint-config-basic | Pawl                                                    |
| --------------- | ------------------- | ------------------------------------------------------- |
| Vitest          | Yes                 | 7 test rules through Biome, more with the optional pack |
| Jest            | Yes                 | The same 7 test rules, more with the optional pack      |
| Playwright      | Yes                 | Biome's Playwright rules, more with the optional pack   |
| Testing Library | Yes                 | Optional pack                                           |
| jest-dom        | Yes                 | Optional pack                                           |
| Cypress         | Yes                 | Optional pack                                           |

### Rule packs

| Pack                     | eslint-config-basic | Pawl                                                                                         |
| ------------------------ | ------------------- | -------------------------------------------------------------------------------------------- |
| Accessibility            | Yes                 | Biome's recommended accessibility rules, more with the optional pack                         |
| Best practices           | Yes                 | Yes, 3 of 3 (1 strict only)                                                                  |
| No focused tests         | Yes                 | Yes                                                                                          |
| Unicorn                  | Yes                 | 16 of 26 through Biome (4 strict only) and 8 through Oxlint; the rest with the optional pack |
| Security                 | Yes                 | Biome's recommended security rules, more with the optional pack                              |
| Boundaries               | Yes                 | 1 of 3, strict only                                                                          |
| Node (`eslint-plugin-n`) | Yes                 | Optional pack                                                                                |
| Regexp                   | Yes                 | Optional pack                                                                                |
| Perfectionist            | Yes                 | Import sorting through Biome; the rest with the optional pack                                |
| SonarJS                  | Yes                 | Optional pack                                                                                |
| Compat (browserslist)    | Yes                 | Optional pack                                                                                |
| De Morgan                | Yes                 | Pawl's own rule, no plugin: `pawl add de-morgan`                                             |
| Depend                   | Yes                 | Optional pack. Pawl also flags undeclared dependencies itself                                |
| Astro Doctor             | Yes                 | Optional pack (`astro-doctor`)                                                               |

### Tools

| Tool           | eslint-config-basic | Pawl                                                                           |
| -------------- | ------------------- | ------------------------------------------------------------------------------ |
| Turborepo      | Yes                 | Detected, 1 rule, per-package configs                                          |
| Nx             | Yes                 | Detected                                                                       |
| pnpm           | Yes                 | Detected as the package manager. Optional pack (`pnpm`)                        |
| Prettier       | Compatibility       | A formatter you can choose                                                     |
| CSpell         | Yes                 | Optional pack                                                                  |
| JSDoc          | Yes                 | Optional pack                                                                  |
| Docker         | Yes                 | Pawl's own checks for Dockerfiles and Compose files (17), plus the `yaml` pack |
| GitHub Actions | Yes                 | No rules. `init --workflow` writes a workflow                                  |
| Swagger        | Yes                 | Optional pack (`swagger`), 9 rules                                             |

### Libraries

| Library                                                                          | eslint-config-basic | Pawl                                                                                            |
| -------------------------------------------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------- |
| Tailwind CSS                                                                     | Yes                 | Biome's Tailwind rules, more with the optional pack (`tailwind`)                                |
| TanStack Query                                                                   | Yes                 | Biome's TanStack Query rules, more with the optional pack                                       |
| ORM                                                                              | Yes                 | Biome's Drizzle rules. Other ORMs are out of the goal                                           |
| Zod                                                                              | Yes                 | Optional pack                                                                                   |
| Stencil                                                                          | Yes                 | Optional pack                                                                                   |
| Storybook                                                                        | Yes                 | Optional pack                                                                                   |
| i18next                                                                          | Yes                 | Optional pack                                                                                   |
| AI SDK, LangChain, LlamaIndex, Mastra, MCP, OpenAI Agents, AutoGen, Google GenAI | Yes                 | Guards for each, with no plugin, plus OpenAI and Anthropic. Optional pack for the AI SDK (`ai`) |

### Commands and workflow

| Feature                          | eslint-config-basic      | Pawl                                                                                         |
| -------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------- |
| `init`                           | Writes the ESLint config | Writes config, scripts, editor settings and the baseline; optional CI, hooks and agent files |
| `check` and `fix`                | Through `eslint`         | Yes, across engines                                                                          |
| `explain`                        | Yes                      | Yes                                                                                          |
| `doctor`                         | Yes, with `--fix`        | Yes. `sync` repairs the config                                                               |
| `baseline`                       | Yes                      | Yes, plus a ratchet on disable comments                                                      |
| `profile` (time budgets)         | Yes                      | Not planned                                                                                  |
| `snapshot` and `diff`            | Yes                      | Not planned                                                                                  |
| `config-types`                   | Yes                      | Not needed                                                                                   |
| `migrate`                        | From its own v2          | Yes, from any ESLint flat config                                                             |
| Agent files                      | `generate-skill`         | `AGENTS.md` block and a Claude Code hook                                                     |
| Output for agents                | No                       | Yes, `--format agent`                                                                        |
| ESLint MCP scaffold              | Yes                      | Not planned                                                                                  |
| GitHub Action                    | Yes                      | `init --workflow` writes a workflow                                                          |
| Company policy with locked rules | No                       | Yes                                                                                          |
| Per-package rules in a monorepo  | Not checked              | Yes, through per-package Biome configs                                                       |

### Optional packs

50 packs, each checked against its real plugin:

| Kind                                   | Packs                                                                                                                             |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Base, on whenever ESLint is the linter | `javascript`, `typescript`                                                                                                        |
| Frameworks                             | `react-hooks`, `preact`, `next`, `angular`, `nest`, `hono`, `vue`, `svelte`, `astro`, `astro-doctor`, `solid`, `lit`, `stencil`   |
| Testing                                | `vitest`, `jest`, `jest-dom`, `testing-library`, `playwright`, `cypress`, `storybook`                                             |
| Libraries                              | `zod`, `tanstack-query`, `tanstack-router`, `i18next`, `ai`, `tailwind`, `graphql`, `graphql-schema`, `swagger`                   |
| Rule packs                             | `unicorn`, `regexp`, `node`, `promise`, `perfectionist`, `jsdoc`, `security`, `sonarjs`, `jsx-a11y`, `compat`, `depend`, `cspell` |
| Formats                                | `yaml`, `jsonc`, `markdown`, `toml`, `html`, `package-json`, `pnpm`                                                               |

A pack for something the project depends on is offered by `pawl init`. The others are opt-in: `pawl add unicorn`.

A pack can also start from the plugin's own preset: `unicorn/recommended` is the unicorn pack on top of everything the plugin recommends.

### What is left

1. Move the 27 strict-only rules into the default standard as Biome and Oxlint mark them stable: 26 in Biome and `import/export` in Oxlint.
2. Packs for Vite and Slidev. The old config only set file patterns for them.
3. `profile`, `snapshot` and `diff` are not planned unless you want them back.

## Not built yet

- Oxlint's type-aware rules. They run through a separate component pawl does not drive.
- Code-pattern guards under Oxlint alone. They run in Biome and in ESLint. Oxlint's own plugin system is in alpha and crashed where pawl was built, so it is not used yet.
- Rewriting the larger plugins. Pawl's own rules match shapes of code; plugins such as unicorn, regexp or typescript-eslint analyse it, and stay optional packs.
- Linting an OpenAPI document itself. The `swagger` pack checks the NestJS decorators that produce it.
- Languages other than JavaScript and TypeScript.

## License

MIT
