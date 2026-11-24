# @santi020k/pawl

Fast guardrails for AI-written code. One standard, for the linter and formatter you choose.

[Documentation](https://pawl.santi020k.com) · [Changelog](https://pawl.santi020k.com/changelog/) · [Upgrading](https://pawl.santi020k.com/guide/upgrade/)

> **Before 1.0:** a minor release may change the API or the standard. Read a release's notes before you move to it.

## Set up a repo

```sh
npx @santi020k/pawl init
```

`init` looks at the repo, shows what it will change, and asks before writing. In a terminal it asks how to set up the tools, then what else to add: the editor, coding agents, a pre-commit hook or a GitHub workflow. In CI or under a coding agent it asks nothing and uses `auto`.

| Mode             | What it does                                                        |
| ---------------- | ------------------------------------------------------------------- |
| `auto` (default) | Biome lints and formats. An existing ESLint setup is left in place. |
| `keep`           | Stay on the engine the repo uses today and add the ratchet on top.  |
| `biome`          | Biome only. Pawl stops running ESLint.                              |

Useful flags: `--yes`, `--dry-run`, `--mode <mode>`, `--workflow` (GitHub Actions: the check, and the doctor report as an artifact), `--agents` (hooks that fix each edit for Claude Code, and for Cursor, Codex and Copilot where the repo uses them; instructions in `AGENTS.md` that Claude Code and Gemini CLI read too; a pawl skill), `--hooks` (a pre-commit hook), `--no-editor`, `--no-install`.

`init` writes:

- `biome.json`, a few lines that extend the standard and turn on Biome's `.gitignore` support;
- `check` and `fix` scripts in `package.json`;
- `.vscode/settings.json`, so the editor formats and fixes on save, `.vscode/extensions.json`, which recommends the editor extension, and `.vscode/tasks.json`, with tasks that put the findings in the Problems panel;
- `.pawl/baseline.json`, the findings the repo already has.

Pawl never deletes or overwrites a tool config you already have. It tells you what you can remove.

## Coming from an ESLint config

```sh
npx @santi020k/pawl migrate
```

`migrate` reads your `eslint.config.js` the way ESLint resolves it, compares it with the pawl standard, and writes the difference:

- `pawl.config.ts` with the rule levels and options that differ, ordered overrides for supported file scopes, the packs for the plugins you use, the style from your formatting rules or Prettier config, and your ignores.
- `eslint.config.js` as one line, `export default eslint({ root: import.meta.dirname })`. The old file is kept as `eslint.config.before-pawl.js`.
- `.pawl/migration.md`, a full account: what was kept, what the formatter replaces, what the standard adds.

Then it runs `init`, so the tools are installed and the baseline is recorded unless `--no-baseline` is supplied. `--dry-run` shows the plan and changes nothing. `--keep-config` leaves the ESLint config file alone.

Flat-config file scopes keep their order and apply to future files, including scopes imported from shared configs. Migration stops before writing when a scope cannot be preserved, such as local ignores, AND-pattern arrays or scoped formatting rules. The report lists the preserved scopes for review. See the [migration guide](https://pawl.santi020k.com/guide/migrate/) for the supported forms and limitations.

Convert a legacy `.eslintrc` with `npx @eslint/migrate-config <config-file>` first and review the flat config. Migration no longer flattens legacy configs from samples, which could lose inherited overrides.

## Daily use

```sh
pawl check              # lint, check formatting, apply the ratchet
pawl check --changed    # only files changed against HEAD
pawl check --since origin/main  # only files the branch changed
pawl fix                # apply safe fixes and format
pawl baseline           # accept the current findings as the new baseline
pawl sync               # rewrite biome.json after the policy changed
pawl explain no-console # what a rule does, and its level in this repo
pawl doctor             # check the setup and the tool versions
pawl doctor --format json  # the same, as one JSON document for CI
pawl check --max-warnings 0  # also fail on new warnings
```

The engines also work on their own: `npx biome check` and `npx eslint .` use the same config files.

### Exit codes

| Code | Meaning                                                                                       |
| ---- | --------------------------------------------------------------------------------------------- |
| 0    | No new errors                                                                                 |
| 1    | New errors, or more new warnings than `--max-warnings` or the policy's `maxWarnings` allows   |
| 2    | A setup problem: an engine could not run, or, with `--ci`, the config drifted from the policy |

`--ci` is on automatically when the `CI` environment variable is set, as CI services set it; an empty value, `0` and `false` mean it is not.

### Output for coding agents

```sh
pawl check --changed --format agent
```

One JSON object per line, errors first, and nothing at all when there is nothing to do:

```json
{
  "file": "src/api.ts",
  "line": 1,
  "rule": "biome:correctness/noUndeclaredDependencies",
  "message": "Dependency made-up-package isn't specified in package.json.",
  "fix": "Check that the package exists and is the one you mean, then add it to package.json."
}
```

A coding agent gets this format without asking: pawl knows Claude Code, Cursor, Codex, Gemini CLI and other agents by the variables they set, and shows them no colors, spinners or questions in any command. `PAWL_AGENT=0` says a person is running pawl.

### Output for people and editors

In a terminal, `pawl check` shows each finding with the line of code it points at, a mark under the part it means and how to fix it, then a summary. `pawl init` asks its questions and shows its plan step by step, and `pawl doctor` marks each part of the setup. In a pipe or a log, the same facts print as plain lines.

`--format editor` prints `src/a.ts:3:7: error: message [rule]` lines, which VS Code's problem matchers, Vim's quickfix list and Emacs's compilation mode read. The tasks `init` writes for VS Code use it. `--format json` prints the whole result as one document, with `reportVersion: 1`. The public `readCheckReport` helper validates captured output against the actual process status; malformed output and setup failures never count as clean checks.

In a coding agent's post-edit hook, `pawl fix --hook` reads the files the agent edited from the hook's input, fixes and checks only those, and hands what is left back to the agent in the shape its tool reads: Claude Code, Codex and Copilot put it in front of the model, Cursor reads nothing back. In the agent's stop hook, `pawl check --hook` checks every file the agent edited in the session and sends it back while new errors are left, Cursor included. `pawl init --agents` writes these hooks, with `npx --no pawl` so a repo that has not installed pawl yet never downloads the unscoped `pawl` package, which is someone else's. See [Coding agents](https://pawl.santi020k.com/guide/agents/).

## The policy

A repo on the default standard needs no config file. To change something, add `pawl.config.ts`:

```ts
import { definePolicy } from '@santi020k/pawl'

export default definePolicy({
  extends: '@santi020k/pawl-policy',
  rules: { 'no-console': 'off' },
  ignore: ['generated/**']
})
```

Then run `pawl sync`. `pawl.config.js`, `.mjs` and `.json` work too.

| Option           | Meaning                                                                                        |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| `extends`        | Policies to build on: a package, a relative path, or an inline policy. Later ones win.         |
| `engine`         | The linter: `auto` (default), `biome`, `oxlint` or `eslint`.                                   |
| `formatter`      | `auto` (default), `biome` or `prettier`.                                                       |
| `strict`         | Use the stricter level of every rule that has one. A later layer cannot turn it off.           |
| `maxWarnings`    | Fail the check on more new warnings than this. A later layer can only lower it.                |
| `style`          | `indent`, `lineWidth`, `quotes`, `semicolons`, `trailingCommas`, `arrowParens`.                |
| `rules`          | Levels by rule name: `off`, `warn` or `error`.                                                 |
| `options`        | Options by rule name, in ESLint's shape. ESLint and Oxlint take them.                          |
| `biomeOptions`   | Options by rule name, in Biome's shape. Only Biome takes them.                                 |
| `overrides`      | Levels and options for some files only: `[{ files: ['*.test.ts'], rules: { ... } }]`.          |
| `packs`          | Optional packs to switch on. `unicorn/recommended` starts a pack from the plugin's own preset. |
| `locked`         | Rules that later layers may tighten but not loosen.                                            |
| `ignore`         | Extra glob patterns to skip. A pattern without a slash matches at any depth.                   |
| `gitignore`      | Skip what the root `.gitignore` lists. On by default.                                          |
| `defaultIgnores` | Skip build output, caches, lockfiles, AI tool folders and generated code. On by default.       |
| `runtime`        | `node`, `browser`, `bun`, `deno` or `worker`, instead of what pawl detects.                    |
| `detect`         | `false` turns detection off; `{ exclude: ['tailwind'] }` leaves a technology out.              |
| `languages`      | Other languages to check with their own tools: `['rust', 'swift', 'kotlin']`. Off by default.  |

Rule names are ESLint's names. Use `biome:group/name` for a rule only Biome has. Any other name pawl does not know is passed to ESLint. An option pawl does not know stops the run, and so does a value it cannot use, such as a level that is not `off`, `warn` or `error`, so a typo never passes in silence. `pawl.config.json` can point `$schema` at `./node_modules/@santi020k/pawl/pawl.config.schema.json` for editor completion.

### What pawl skips

Every engine skips the same files: build output and caches, test reports, lockfiles, the folders AI coding tools keep (`.claude`, `.cursor` and others), generated code (`__generated__`, `*.gen.*`, `.prisma`), what the tools of other languages write (Cargo's `target`, `Cargo.lock`, `Package.resolved`, Xcode's asset catalogs and project bundles, `Pods`, `.gradle`), `CHANGELOG.md`, what the root `.gitignore` lists, and your `ignore` list. Biome reads the `.gitignore` through its git integration, pawl turns it into ESLint's patterns, and Oxlint reads it itself.

### Runtimes

Pawl works out where the code runs, from the dependencies and config files, and gives each linter those globals: Node, the browser, Bun, Deno or Cloudflare Workers. Name them with `runtime` when it guesses wrong.

The default style is 2 spaces, single quotes, no semicolons, no trailing commas and a line width of 120.

### A shared policy

A policy can live in an npm package whose default export is a policy. [`@santi020k/pawl-policy`](../pawl-policy) is a real one: the strict policy Santiago Molina uses on his own projects. Extend it, fork it, or publish your own under your own scope, such as `@acme/pawl-policy`:

```js
// @acme/pawl-policy/index.js
export default {
  extends: '@santi020k/pawl-policy',
  rules: { 'no-console': 'error' },
  locked: ['no-console']
}
```

Repos extend it. A repo can still tighten any rule, but an attempt to loosen a locked one is ignored and reported by `pawl check` and `pawl doctor`. Policy packages must ship JavaScript, because Node does not run TypeScript from `node_modules`.

## The ratchet

`.pawl/baseline.json` records how many findings of each rule each file had when the repo adopted the standard. Commit it.

- Findings within those counts are allowed.
- Anything beyond them fails the check.
- A file that gains a disable comment (`biome-ignore`, `eslint-disable`, `oxlint-disable`, `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`) fails with `pawl/no-new-disable`.
- A test file that loses assertions or gains a skipped test fails with `pawl/no-weaker-tests`. The baseline counts the assertions that pin a value, so swapping one for `toBeTruthy()` lowers the count. See [Tests that get weaker](https://pawl.santi020k.com/guide/ratchet/#tests-that-get-weaker).
- When the code improves, `pawl check` says so. Run `pawl baseline` to lock the improvement in.

Counts are per file and rule, not per line, so moving code around does not break the baseline. The cost is that when a file goes over its count, every finding of that rule in the file is shown.

## Rules

The standard has 201 rules, named with ESLint's names. They started from `@santi020k/eslint-config-basic`: every rule it set that Biome or Oxlint can enforce without a plugin is here, at the level it had.

- Rules for React, Qwik, Vue, Svelte and Turborepo apply only where that technology is used.
- For each technology a project uses, pawl also turns on the rules Biome itself recommends for it: React, Next.js, React Native, Qwik, Solid, Vue, Svelte, Astro, Tailwind CSS, TanStack Query, Drizzle, Playwright and Turborepo.
- Rules their engine still marks as unstable are off unless the policy is `strict`.
- 17 rules have no Biome equivalent. Oxlint enforces them, or ESLint where the project has the plugin's pack on. With Biome as the linter they do not run, and `pawl explain` says so.
- An old name for the same check works too: `@typescript-eslint/no-unused-vars` sets `no-unused-vars`.

`pawl explain <rule>` shows a rule's level in your repo and which engine rule enforces it.

## Monorepos

Pawl detects pnpm, npm and yarn workspaces, Turborepo and Nx. It runs once from the root and covers every package. In a Turborepo, `init` also adds `check` and `fix` to `turbo.json` as root tasks, uncached, so `turbo run check` runs pawl with the rest. Under Nx it makes the root a project with `check` and `fix` as uncached targets, so `nx run-many -t check` does the same.

A rule for a technology runs only in the packages that use it, under every linter. With Biome, `init` keeps package-specific domains and rules in the root `biome.json`, scoped to each package. Root-relative policy ignores and overrides therefore retain their exact meaning. For example, React rules apply inside `apps/web/**` without changing the Node API package.

With Oxlint, `.oxlintrc.json` has an override for the package, with the rules and the plugins they need. With ESLint, the flat config has a block for it, and a pack only some packages depend on, such as `react-hooks`, runs in those packages only. So React rules apply in the React app and not in the Vue app next to it. `pawl check` reports a package that starts using a new technology until `pawl sync` has been run.

## Rust, Swift and Kotlin

Pawl finds Cargo, Swift Package Manager, Xcode and Gradle projects anywhere in the repo, keeps the JavaScript engines out of what their tools write, and lists them in `pawl doctor`. Name a language in the policy and `pawl check` runs its own tools there, with the project's own config, under the same baseline and report:

```ts
export default definePolicy({ languages: ['rust', 'swift', 'kotlin'] })
```

| Language | Lint      | Format                      |
| -------- | --------- | --------------------------- |
| Rust     | Clippy    | rustfmt                     |
| Swift    | SwiftLint | SwiftFormat or swift-format |
| Kotlin   | ktlint    | ktlint                      |

Findings keep the tool's rule name, such as `clippy:unwrap_used`, and `rules` and `overrides` can set their levels. A tool that is missing is a setup problem with exit code 2. Pawl does not install these tools. Leave `languages` out when [Quality](https://quality.santi020k.com) already runs them, so nothing runs twice.

## Choosing tools

Pawl has no dependencies. Every tool is an optional peer, and `init` installs the ones you pick.

| Job    | Choices                 | Default on auto |
| ------ | ----------------------- | --------------- |
| Lint   | Biome, Oxlint or ESLint | Biome           |
| Format | Biome or Prettier       | Biome           |

```sh
pawl init                                      # ask, or use auto without a terminal
pawl init --engine eslint --formatter prettier # say it up front
```

Or in the policy: `engine: 'eslint'`, `formatter: 'prettier'`. Any mix works: Biome can lint while Prettier formats, and ESLint can lint while Biome formats.

Biome is pinned to one exact version, because pawl reads a report format Biome may change between releases. `pawl doctor` checks the installed Biome against it, and Node, ESLint, Oxlint, Prettier and the pack plugins against the versions pawl declares.

Biome also lints and formats CSS and GraphQL, sorts `package.json` fields in the usual order, and parses Tailwind's at-rules in projects that use Tailwind.

Oxlint enforces 162 of the standard's 201 rules under their ESLint names. It refuses a config that names a rule it does not have, so pawl writes `.oxlintrc.json` in full and keeps it in step with `pawl sync`. Nine more need type information and run through `oxlint-tsgolint`, which `pawl init` adds to TypeScript projects. Pawl writes them where the project depends on it.

## Packs

A pack is a set of ESLint rules for one plugin. Pawl holds the rules and levels; your project installs the plugin.

```sh
pawl add zod testing-library   # installs eslint and the plugins, writes eslint.config.js if needed
pawl doctor                    # shows which packs are active
```

| Kind                                   | Packs                                                                                                                             |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Base, on whenever ESLint is the linter | `javascript`, `typescript`                                                                                                        |
| Frameworks                             | `react-hooks`, `preact`, `next`, `angular`, `nest`, `hono`, `vue`, `svelte`, `astro`, `astro-doctor`, `solid`, `lit`, `stencil`   |
| Testing                                | `vitest`, `jest`, `jest-dom`, `testing-library`, `playwright`, `cypress`, `storybook`                                             |
| Libraries                              | `zod`, `tanstack-query`, `tanstack-router`, `i18next`, `ai`, `tailwind`, `graphql`, `graphql-schema`, `swagger`                   |
| Rule packs                             | `unicorn`, `regexp`, `node`, `promise`, `perfectionist`, `jsdoc`, `security`, `sonarjs`, `jsx-a11y`, `compat`, `depend`, `cspell` |
| Formats                                | `yaml`, `jsonc`, `markdown`, `toml`, `html`, `package-json`, `pnpm`                                                               |

- A pack for something your project depends on switches on as soon as its plugin is installed. `init` tells you which ones fit.
- The rule packs and formats are opt-in: `pawl add` records them under `packs` in the policy.
- A pack starts from the plugin's own recommended rules, then applies the standard's levels, then your policy's `rules`.
- The `typescript` pack starts from typescript-eslint's `strictTypeChecked` and `stylisticTypeChecked` presets, so it needs type information.
- Where Biome is the linter, it keeps the rules it already enforces, so nothing is reported twice.
- `unicorn/recommended` in `packs` starts the unicorn pack from the plugin's own recommended preset. Any pack takes a preset name this way.
- A rule the installed plugin does not have is left out and listed by `pawl doctor`, so an older plugin does not break the run.

The ESLint config stays one line:

```js
// eslint.config.js
import { eslint } from '@santi020k/pawl'

export default eslint({ root: import.meta.dirname })
```

The root keeps the config independent of the folder an editor starts ESLint in.

## Guards

A guard is a set of checks for one library that needs no plugin. It switches on when the project depends on the library.

| Guard                                          | On when the project uses                 | What it refuses                                                                                                                                           |
| ---------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ai-keys`                                      | Any AI SDK below, but AutoGen            | An API key written in the code, and `dangerouslyAllowBrowser: true`                                                                                       |
| `ai-sdk`                                       | `ai`, `@ai-sdk/*`                        | Imports of package internals                                                                                                                              |
| `openai`, `anthropic`                          | `openai`, `@anthropic-ai/sdk`            | Imports of package internals                                                                                                                              |
| `openai-agents`                                | `@openai/agents`                         | Internals, and agents from the base OpenAI client                                                                                                         |
| `google-genai`                                 | `@google/genai`, `@google/generative-ai` | Internals, and the legacy `@google/generative-ai` SDK                                                                                                     |
| `langchain`, `llamaindex`, `mastra`, `autogen` | Those packages                           | Imports of package internals                                                                                                                              |
| `mcp`                                          | `@modelcontextprotocol/sdk`              | Imports of internal modules                                                                                                                               |
| `hono`                                         | `hono`                                   | Internals, and a hand-written wildcard CORS header                                                                                                        |
| `zod`                                          | `zod`                                    | `.optional().nullable()`, `z.object().strict()` or `.passthrough()`, `.trim()` after a length check, a method after `.meta()`, a union of string literals |
| `testing-library`                              | Any Testing Library package              | `await` on a synchronous `getBy` or `queryBy` query, and queries taken from `render()` instead of `screen`                                                |
| `testing-library-find-by`                      | Any Testing Library package              | `waitFor()` around a `getBy` or `queryBy` query, where `findBy` waits by itself (warn)                                                                    |
| `testing-library-debug`                        | Any Testing Library package              | `screen.debug()`, `prettyDOM()` and other debugging calls (warn)                                                                                          |
| `testing-library-dom`                          | A framework's Testing Library package    | Imports of `@testing-library/dom` in place of the framework's one                                                                                         |
| `nuxt`                                         | `nuxt`                                   | `process.client`, `process.server` and the other flags `import.meta` has                                                                                  |
| `de-morgan`                                    | Opt-in: `pawl add de-morgan`             | `!(a && b)` and `!(a \|\| b)`                                                                                                                             |
| `zod-meta`                                     | Opt-in: `pawl add zod-meta`              | `.describe()` in place of Zod 4's `.meta()`                                                                                                               |

- Import restrictions are enforced by the linter you use: Biome, Oxlint or ESLint.
- Code patterns (keys, `dangerouslyAllowBrowser`, the CORS header, the Zod, Testing Library and Nuxt patterns, De Morgan) run in Biome as rules pawl writes itself, into `.pawl/rules/`. Commit that folder; `pawl sync` keeps it current. ESLint runs the same patterns as selectors.
- With Oxlint as the only linter, the code patterns do not run. `pawl doctor` says so.
- Your own `no-restricted-imports` and `no-restricted-syntax` options in the policy are merged with the guards.
- Set a guard's level with `rules: { 'pawl/ai-keys': 'warn' }`, or `'off'`. `'no-restricted-imports': 'off'` turns every import guard off.
- In a monorepo, package rules share the root Biome configuration and its rule files. Existing nested configs require explicit migration; see the upgrade guide.

## Dockerfiles and Compose files

Pawl checks these itself, since no engine reads them. The checks run with `pawl check`, follow the baseline, and take a level in the policy like any rule.

| Check                                               | Level | What it finds                                       |
| --------------------------------------------------- | ----- | --------------------------------------------------- |
| `pawl/docker-pin-image`, `pawl/compose-pin-image`   | warn  | An image with no version, or `latest`               |
| `pawl/docker-no-secrets`, `pawl/compose-no-secrets` | error | A password, token or key written into the file      |
| `pawl/docker-no-root`                               | warn  | An image that runs as root                          |
| `pawl/docker-prefer-copy`                           | warn  | `ADD` for a local file                              |
| `pawl/docker-no-sudo`                               | warn  | `sudo` in a build step                              |
| `pawl/docker-apt-no-recommends`                     | warn  | `apt-get install` without `--no-install-recommends` |
| `pawl/docker-npm-ci`                                | warn  | `npm install` where `npm ci` belongs                |
| `pawl/docker-exec-form`                             | warn  | `CMD` or `ENTRYPOINT` in shell form                 |
| `pawl/docker-no-curl-pipe`                          | warn  | A download piped into a shell                       |
| `pawl/docker-workdir-absolute`                      | warn  | A relative `WORKDIR`                                |
| `pawl/docker-no-maintainer`                         | warn  | The deprecated `MAINTAINER`                         |
| `pawl/compose-no-privileged`                        | warn  | `privileged: true`                                  |
| `pawl/compose-no-docker-socket`                     | warn  | A mount of the Docker socket                        |
| `pawl/compose-no-host-network`                      | warn  | `network_mode: host`                                |
| `pawl/compose-no-version`                           | warn  | The obsolete top-level `version`                    |

`pawl explain docker-no-root` shows a check and how to fix what it finds.

## Markdown files

Pawl also checks Markdown files itself, skipping code blocks, code spans, HTML comments and front matter.

| Check                                 | Level | What it finds                                                  |
| ------------------------------------- | ----- | -------------------------------------------------------------- |
| `pawl/markdown-no-empty-links`        | error | A link with no destination: `[text]()` or `[text](#)`          |
| `pawl/markdown-no-duplicate-headings` | off   | A heading with the same text as an earlier one in the document |
| `pawl/markdown-no-invalid-label-refs` | error | A reference with whitespace between its brackets: `[text][ ]`  |
| `pawl/markdown-no-missing-label-refs` | off   | A reference such as `[text][label]` with no `[label]:` line    |

## Hidden characters

`pawl/no-hidden-characters` (error) finds characters that do not show on screen: zero-width characters, bidi controls, invisible operators, Unicode tag characters and runs of variation selectors. A rules file or a skill can hide instructions in them that an agent follows and a reviewer never sees. It reads code, docs, and the instructions, skills and settings of coding agents, including the folders such as `.claude` and `.cursor` that the default ignores skip. Emoji, flags, and the marks other scripts use next to their own letters are left alone. See [Hidden characters](https://pawl.santi020k.com/guide/guards/#hidden-characters).

## API

Everything the CLI does is exported: `check`, `doctor`, `planInit`, `applyPlan`, `detect`, `loadPolicy`, `definePolicy`, `eslint`, `biomeProjectConfig`, `RULES`, `POLICY_SCHEMA` and the types. See `src/index.ts`. The policy's JSON schema is `@santi020k/pawl/schema.json`.

## License

MIT

## Strict adoption and integrations

Use `pawl init --yes --no-baseline` to adopt without accepting existing findings.
Existing baseline files remain unchanged and still apply; review them separately.
`pawl sync --dry-run` previews configuration and ownership metadata writes.

Pawl tracks newly generated Biome override ownership and backs up eligible updates.
Unknown or edited scopes are preserved until manually reconciled. Import-sort
conflicts between Biome and ESLint block fixes before writing.

Public ESLint helpers accept plugin roots, explicit plugin namespace bindings,
shared base configuration and processor-safe integration options. The policy's
`testRunners` field scopes runner-specific checks without narrowing universal
focused/skipped-test rules or locked floors.

`pawl check --eslint-cache` is an explicit opt-in requiring a deterministic-input
declaration; full input hashing can cost more than the work it saves. See the
[adoption and integration guides](https://pawl.santi020k.com/guide/strict-adoption/)
for contracts, limitations and examples.
