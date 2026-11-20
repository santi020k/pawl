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
- A Prettier config decides the `style` where there is one, in `.prettierrc`, `.prettierrc.json` or `package.json`. An option it leaves out counts as what Prettier does by itself, such as double quotes and 80 columns, so the code keeps the format it has. Pawl says so when the config is one it cannot read, such as `prettier.config.js`; set `style` by hand then.
- Import ordering rules are dropped: import sorting does their job.
- When your config follows a plugin's own recommended preset, the pack starts from it, as in `unicorn/recommended`.
- Rules the standard adds apply from now on. Their existing findings go into the baseline, so nothing fails on day one.

## Options

| Option          | Meaning                                                 |
| --------------- | ------------------------------------------------------- |
| `--dry-run`     | Show the plan and change nothing                        |
| `--keep-config` | Write the policy and leave the ESLint config file alone |
| `--yes`         | Do not ask before writing                               |

`pawl init` does not read an ESLint config: with an `.eslintrc` it says so and points here, because migrating is the only way that file's rules reach the policy. Run `pawl migrate` first, in place of `init`.

A legacy `.eslintrc` works too, as long as the project has ESLint 8 or 9. Pawl writes a new `eslint.config.js` and leaves the old file for you to delete. ESLint 10 no longer reads `.eslintrc`: convert it with `npx @eslint/migrate-config` first.
