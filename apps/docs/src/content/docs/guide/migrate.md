---

title: Coming from ESLint
description: Turn an existing ESLint config into a pawl policy with one command.
---

```sh
npx @santi020k/pawl migrate
```

`migrate` reads your `eslint.config.js` the way ESLint resolves it, compares the result with the pawl standard, and writes down only the difference.

## What it writes

| File                 | Content                                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `pawl.config.ts`     | The rule levels and options that differ from the standard, the packs for the plugins you use, the style, and your ignores |
| `eslint.config.js`   | One line: `export default eslint({ root: import.meta.dirname })`. The old file is kept as `eslint.config.before-pawl.js`  |
| `.pawl/migration.md` | A full account of what was kept, what the formatter replaces, and what the standard adds                                  |

Then it runs `init`, which installs the tools and records the baseline.

## How rules are carried over

- A rule at the same level as the standard, or as a pack sets it, is not written down.
- A rule at a different level is kept at your level, under `rules`. Delete the line to take the standard.
- Options that differ go under `options`. ESLint and Oxlint take them. Biome keeps the standard's; set `biomeOptions` by hand where you need the same in Biome.
- Formatting rules are dropped: the formatter does their job. Their quotes, semicolons, indent and line width become the `style`.
- Import ordering rules are dropped: import sorting does their job.
- When your config follows a plugin's own recommended preset, the pack starts from it, as in `unicorn/recommended`.
- Rules the standard adds apply from now on. Their existing findings go into the baseline, so nothing fails on day one.

## Shared configs

When your config comes from a shared config package, the plugins are often that package's dependencies and not your project's. `migrate` looks for them there too, so a plugin rule at the level its pack sets is not written down.

Once the shared config is gone your project needs those plugins itself. `migrate` lists them under "Rules that cannot run yet" in the report, and the `init` that follows installs the plugin of every pack it switched on.

## Ignores

The ignore patterns of your config are carried over, from a JavaScript or a TypeScript config. A pattern pawl already skips by default is left out, also when it is repeated for each workspace, as in `packages/a/**/dist`. A path of your own, such as `apps/web/public/archive`, is kept.

## Onto a company policy

```sh
npx @santi020k/pawl migrate --extends @acme/pawl-policy
```

With `--extends`, the new `pawl.config.ts` builds on that policy, and `migrate` compares your config with the standard plus the policy. Only what differs from the policy is written down: rule levels, style and ignores.

Moving onto a policy means taking its levels. Where your old config had a rule looser than the policy, `migrate` leaves it out and lists it in the report as kept at the policy's level; a rule your config had stricter is still carried over. You can loosen a rule again under `rules`, unless the policy locks it.

Install the policy package first: `migrate` has to read it to compare. A relative path to a policy file works too.

## Options

| Option          | Meaning                                                 |
| --------------- | ------------------------------------------------------- |
| `--dry-run`     | Show the plan and change nothing                        |
| `--keep-config` | Write the policy and leave the ESLint config file alone |
| `--extends`     | Build on a policy and carry over only what differs      |
| `--yes`         | Do not ask before writing                               |

A legacy `.eslintrc` works too, as long as the project has ESLint 8 or 9. Pawl writes a new `eslint.config.js` and leaves the old file for you to delete. ESLint 10 no longer reads `.eslintrc`: convert it with `npx @eslint/migrate-config` first.
