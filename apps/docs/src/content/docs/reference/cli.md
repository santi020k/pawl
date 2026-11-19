---

title: CLI
description: Every pawl command and option.
---

| Command               | What it does                                                   |
| --------------------- | -------------------------------------------------------------- |
| `pawl init`           | Set up this repo                                               |
| `pawl check [files]`  | Lint, check formatting and apply the ratchet                   |
| `pawl fix [files]`    | Apply safe fixes and format                                    |
| `pawl sync`           | Rewrite engine config files from the policy                    |
| `pawl add <pack...>`  | Switch on optional packs and install their ESLint plugins      |
| `pawl migrate`        | Turn an existing ESLint config into a pawl policy, then set up |
| `pawl baseline`       | Accept the current findings as the baseline                    |
| `pawl explain <rule>` | Show what a rule does and its level here                       |
| `pawl doctor`         | Check the setup and the tool versions                          |

## Options for check and fix

| Option               | Meaning                                              |
| -------------------- | ---------------------------------------------------- |
| `--changed`          | Only files changed against HEAD, plus untracked ones |
| `--format <kind>`    | `pretty` (default), `agent` or `json`                |
| `--ci`               | Also fail when the setup has drifted from the policy |
| `--max-warnings <n>` | Fail when there are more than `n` new warnings       |
| `--verbose`          | Show the engine commands that ran                    |

`--ci` is on automatically when the `CI` environment variable is `true`. `--max-warnings` counts only warnings the baseline does not allow, and fails with exit code 1; when the policy sets [`maxWarnings`](/reference/config/#maxwarnings), the lower limit wins. `--format agent` prints one JSON line per finding, errors first, with a `fix` where pawl has one; see [Coding agents](/guide/agents/). `--format json` prints the whole result as one document.

## Options for init

| Option               | Meaning                                                               |
| -------------------- | --------------------------------------------------------------------- |
| `--mode <mode>`      | `auto` (default), `keep` or `biome`                                   |
| `--engine <name>`    | The linter: `biome`, `oxlint` or `eslint`                             |
| `--formatter <name>` | The formatter: `biome` or `prettier`                                  |
| `--packs <a,b>`      | Optional packs to switch on                                           |
| `--yes`              | Accept the plan without asking                                        |
| `--dry-run`          | Show the plan and change nothing                                      |
| `--workflow`         | Add a GitHub Actions workflow that also keeps the doctor report       |
| `--agents`           | Add hooks for Claude Code and Cursor, and instructions in `AGENTS.md` |
| `--hooks`            | Add a pre-commit hook that checks changed files                       |
| `--no-editor`        | Skip editor settings                                                  |
| `--no-install`       | Do not run the package manager                                        |

## Options for doctor

| Option            | Meaning                      |
| ----------------- | ---------------------------- |
| `--format <kind>` | `pretty` (default) or `json` |

`--format json` prints the whole report as one document: the project, the policy, the tools, each tool's installed version against the versions pawl works with, the packs the files call for, and the problems. See [Troubleshooting](/guide/troubleshooting/#pawl-doctor).

## Options for migrate

`migrate` takes the options for `init`, and one of its own.

| Option          | Meaning                                                 |
| --------------- | ------------------------------------------------------- |
| `--keep-config` | Write the policy and leave the ESLint config file alone |

## Exit codes

| Code | Meaning                                                |
| ---- | ------------------------------------------------------ |
| 0    | No new errors                                          |
| 1    | New errors, or more new warnings than the limit allows |
| 2    | A setup problem                                        |
