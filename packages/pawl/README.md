# @santi020k/pawl

Fast guardrails for AI-written code. One standard, for the linter and formatter you choose.

> **Status: early.** Not published to npm yet. The API may still change.

## Set up a repo

```sh
npx @santi020k/pawl init
```

`init` looks at the repo, shows what it will change, and asks before writing. In a terminal it offers a menu; in CI or under a coding agent it uses `auto`.

| Mode             | What it does                                                        |
| ---------------- | ------------------------------------------------------------------- |
| `auto` (default) | Biome lints and formats. An existing ESLint setup is left in place. |
| `keep`           | Stay on the engine the repo uses today and add the ratchet on top.  |
| `biome`          | Biome only. Pawl stops running ESLint.                              |

Useful flags: `--yes`, `--dry-run`, `--mode <mode>`, `--workflow` (GitHub Actions), `--agents` (a Claude Code hook, a Cursor hook where `.cursor` exists, and instructions in `AGENTS.md`), `--hooks` (a pre-commit hook), `--no-editor`, `--no-install`.

`init` writes:

- `biome.json`, a few lines that extend the standard;
- `check` and `fix` scripts in `package.json`;
- `.vscode/settings.json`, so the editor formats and fixes on save;
- `.pawl/baseline.json`, the findings the repo already has.

Pawl never deletes or overwrites a tool config you already have. It tells you what you can remove.

## Coming from an ESLint config

```sh
npx @santi020k/pawl migrate
```

`migrate` reads your `eslint.config.js` the way ESLint resolves it, compares it with the pawl standard, and writes the difference:

- `pawl.config.ts` with the rule levels and options that differ, the packs for the plugins you use, the style from your formatting rules or Prettier config, and your ignores.
- `eslint.config.js` as one line, `export default eslint()`. The old file is kept as `eslint.config.before-pawl.js`.
- `.pawl/migration.md`, a full account: what was kept, what the formatter replaces, what the standard adds.

Then it runs `init`, so the tools are installed and the baseline is recorded. `--dry-run` shows the plan and changes nothing. `--keep-config` leaves the ESLint config file alone.

A legacy `.eslintrc` works too, as long as the project has ESLint 8 or 9: pawl reads it, writes a new `eslint.config.js`, and leaves the old file for you to delete. ESLint 10 no longer reads `.eslintrc`, so there convert it with `npx @eslint/migrate-config` first.

## Daily use

```sh
pawl check              # lint, check formatting, apply the ratchet
pawl check --changed    # only files changed against HEAD
pawl fix                # apply safe fixes and format
pawl baseline           # accept the current findings as the new baseline
pawl sync               # rewrite biome.json after the policy changed
pawl explain no-console # what a rule does, and its level in this repo
pawl doctor             # check the setup
```

The engines also work on their own: `npx biome check` and `npx eslint .` use the same config files.

### Exit codes

| Code | Meaning                                                                                       |
| ---- | --------------------------------------------------------------------------------------------- |
| 0    | No new errors                                                                                 |
| 1    | New errors                                                                                    |
| 2    | A setup problem: an engine could not run, or, with `--ci`, the config drifted from the policy |

`--ci` is on automatically when the `CI` environment variable is `true`.

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

`--format json` prints the whole result as one document.

## The policy

A repo on the default standard needs no config file. To change something, add `pawl.config.ts`:

```ts
import { definePolicy } from '@santi020k/pawl'

export default definePolicy({
  extends: '@acme/pawl-policy',
  strict: true,
  rules: { 'no-console': 'off' },
  ignore: ['generated/**']
})
```

Then run `pawl sync`. `pawl.config.js`, `.mjs` and `.json` work too.

| Option      | Meaning                                                                                        |
| ----------- | ---------------------------------------------------------------------------------------------- |
| `extends`   | Policies to build on: a package, a relative path, or an inline policy. Later ones win.         |
| `engine`    | The linter: `auto` (default), `biome`, `oxlint` or `eslint`.                                   |
| `strict`    | Use the stricter level of every rule that has one. A later layer cannot turn it off.           |
| `style`     | `indent`, `lineWidth`, `quotes`, `semicolons`, `trailingCommas`, `arrowParens`.                |
| `rules`     | Levels by rule name: `off`, `warn` or `error`.                                                 |
| `options`   | Options by rule name, in ESLint's shape. ESLint and Oxlint take them; Biome uses pawl's own.   |
| `packs`     | Optional packs to switch on. `unicorn/recommended` starts a pack from the plugin's own preset. |
| `formatter` | `auto` (default), `biome` or `prettier`.                                                       |
| `locked`    | Rules that later layers may tighten but not loosen.                                            |
| `ignore`    | Extra glob patterns to skip.                                                                   |

Rule names are ESLint's names. Use `biome:group/name` for a rule only Biome has. Any other name pawl does not know is passed to ESLint.

The default style is 2 spaces, single quotes, no semicolons, no trailing commas and a line width of 120.

### A company standard

Publish a package whose default export is a policy:

```js
// @acme/pawl-policy/index.js
export default {
  strict: true,
  rules: { 'no-console': 'error' },
  locked: ['no-console', '@typescript-eslint/no-explicit-any']
}
```

Repos extend it. A repo can still tighten any rule, but an attempt to loosen a locked one is ignored and reported by `pawl check` and `pawl doctor`. Policy packages must ship JavaScript, because Node does not run TypeScript from `node_modules`.

## The ratchet

`.pawl/baseline.json` records how many findings of each rule each file had when the repo adopted the standard. Commit it.

- Findings within those counts are allowed.
- Anything beyond them fails the check.
- A file that gains a disable comment (`biome-ignore`, `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`) fails with `pawl/no-new-disable`.
- When the code improves, `pawl check` says so. Run `pawl baseline` to lock the improvement in.

Counts are per file and rule, not per line, so moving code around does not break the baseline. The cost is that when a file goes over its count, every finding of that rule in the file is shown.

## Rules

The standard has 145 rules, named with ESLint's names. They started from `@santi020k/eslint-config-basic`: every rule it set that Biome can enforce without a plugin is here, at the level it had.

- Rules for React, Qwik, Vue, Svelte and Turborepo apply only where that technology is used.
- For each technology a project uses, pawl also turns on the rules Biome itself recommends for it: React, Next.js, React Native, Qwik, Solid, Vue, Svelte, Astro, Tailwind CSS, TanStack Query, Drizzle, Playwright and Turborepo.
- Rules Biome still marks as unstable are off unless the policy is `strict`.
- An old name for the same check works too: `@typescript-eslint/no-unused-vars` sets `no-unused-vars`.

`pawl explain <rule>` shows a rule's level in your repo and which engine rule enforces it.

## Monorepos

Pawl detects pnpm, npm and yarn workspaces, Turborepo and Nx. It runs once from the root and covers every package. In a Turborepo, `init` also adds `check` and `fix` to `turbo.json` as root tasks, uncached, so `turbo run check` runs pawl with the rest. Under Nx it makes the root a project with `check` and `fix` as uncached targets, so `nx run-many -t check` does the same.

When one package uses a technology the rest of the repo does not, `init` gives that package its own small `biome.json`:

```json
{ "root": false, "extends": ["../../biome.json", "@santi020k/pawl/biome/react"] }
```

So React rules apply in the React app and nowhere else. `pawl check` reports a package that starts using a new technology until `pawl sync` has been run.

## Choosing tools

Pawl has no dependencies. Every tool is an optional peer, and `init` installs the ones you pick.

| Job    | Choices           | Default on auto |
| ------ | ----------------- | --------------- |
| Lint   | Biome or ESLint   | Biome           |
| Format | Biome or Prettier | Biome           |

```sh
pawl init                                      # ask, or use auto without a terminal
pawl init --engine eslint --formatter prettier # say it up front
```

Or in the policy: `engine: 'eslint'`, `formatter: 'prettier'`. Any mix works: Biome can lint while Prettier formats, and ESLint can lint while Biome formats.

Biome is pinned to one exact version, because pawl reads a report format Biome may change between releases.

Oxlint enforces 112 of the standard's 145 rules under their ESLint names. It refuses a config that names a rule it does not have, so pawl writes `.oxlintrc.json` in full and keeps it in step with `pawl sync`. Its type-aware rules are not driven by pawl yet.

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
- Where Biome is the linter, it keeps the rules it already enforces, so nothing is reported twice.
- `unicorn/recommended` in `packs` starts the unicorn pack from the plugin's own recommended preset. Any pack takes a preset name this way.
- A rule the installed plugin does not have is left out and listed by `pawl doctor`, so an older plugin does not break the run.

The ESLint config stays one line:

```js
// eslint.config.js
import { eslint } from '@santi020k/pawl'

export default eslint()
```

## Guards

A guard is a set of checks for one library that needs no plugin. It switches on when the project depends on the library.

| Guard                                          | On when the project uses                 | What it refuses                                                     |
| ---------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------- |
| `ai-keys`                                      | Any AI SDK below                         | An API key written in the code, and `dangerouslyAllowBrowser: true` |
| `ai-sdk`                                       | `ai`, `@ai-sdk/*`                        | Imports of package internals                                        |
| `openai`, `anthropic`                          | `openai`, `@anthropic-ai/sdk`            | Imports of package internals                                        |
| `openai-agents`                                | `@openai/agents`                         | Internals, and agents from the base OpenAI client                   |
| `google-genai`                                 | `@google/genai`, `@google/generative-ai` | Internals, and the legacy `@google/generative-ai` SDK               |
| `langchain`, `llamaindex`, `mastra`, `autogen` | Those packages                           | Imports of package internals                                        |
| `mcp`                                          | `@modelcontextprotocol/sdk`              | Imports of internal modules                                         |
| `hono`                                         | `hono`                                   | Internals, and a hand-written wildcard CORS header                  |
| `de-morgan`                                    | Opt-in: `pawl add de-morgan`             | `!(a && b)` and `!(a                                                |     | b)` |

- Import restrictions are enforced by the linter you use: Biome, Oxlint or ESLint.
- Code patterns (keys, `dangerouslyAllowBrowser`, the CORS header, De Morgan) run in Biome as rules pawl writes itself, into `.pawl/rules/`. Commit that folder; `pawl sync` keeps it current. ESLint runs the same patterns as selectors.
- With Oxlint as the only linter, the code patterns do not run. `pawl doctor` says so.
- Your own `no-restricted-imports` and `no-restricted-syntax` options in the policy are merged with the guards.
- Set a guard's level with `rules: { 'pawl/ai-keys': 'warn' }`, or `'off'`. `'no-restricted-imports': 'off'` turns every import guard off.
- In a monorepo, a package with a Biome config of its own gets a copy of the rule files, because Biome looks for them next to that config.

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

## API

Everything the CLI does is exported: `check`, `planInit`, `applyInit`, `detect`, `loadPolicy`, `definePolicy`, `eslint`, `biomeProjectConfig`, `RULES` and the types. See `src/index.ts`.

## License

MIT
