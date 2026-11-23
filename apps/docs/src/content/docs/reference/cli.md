---

title: CLI
description: "Every pawl command and option: init, check, fix, sync, add, migrate, baseline, explain and doctor, with their flags, output formats and exit codes."
head: [{ tag: title, content: "CLI reference: every pawl command and option | pawl" }]
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

| Option               | Meaning                                                                 |
| -------------------- | ----------------------------------------------------------------------- |
| `--changed`          | Only files changed against HEAD, plus untracked ones                    |
| `--since <ref>`      | Only files changed since the branch left `<ref>`, such as `origin/main` |
| `--format <kind>`    | `pretty` (default), `agent` or `json`                                   |
| `--ci`               | Also fail when the setup has drifted from the policy                    |
| `--max-warnings <n>` | Fail when there are more than `n` new warnings                          |
| `--verbose`          | Show the engine commands that ran                                       |
| `--hook`             | For a coding agent's post-edit hook: see below                          |

`[files]` are files and folders, each relative to the folder pawl runs in or absolute, as lint-staged passes them; a folder stands for every file in it, and a path outside the project is left out. Outside a git repository nothing can say what changed, so `--changed` checks every file. `--since` takes the place of `--changed` and of a list of files; see [Only what a pull request changed](/guide/ci/#only-what-a-pull-request-changed). `--ci` is on automatically when the `CI` environment variable is set, as CI services set it; an empty value, `0` and `false` mean it is not. `--max-warnings` counts only warnings the baseline does not allow, and fails with exit code 1; when the policy sets [`maxWarnings`](/reference/config/#maxwarnings), the lower limit wins. `--format agent` prints one JSON line per finding, errors first, with a `fix` where pawl has one; see [Coding agents](/guide/agents/). `--format json` prints the whole result as one document.

`--hook` is for a coding agent's post-edit hook. Pawl reads the files the agent edited from the hook's input on stdin, fixes and checks those files only, and prints what is left in the shape that agent reads back. It always exits with 0 unless the check could not run; then it prints the problem to stderr and exits with 1, so the person sees it and the agent does not. It takes no list of files, `--changed`, `--since` or `--format`. See [Hooks that fix each edit](/guide/agents/#hooks-that-fix-each-edit).

## Options for init

| Option               | Meaning                                                         |
| -------------------- | --------------------------------------------------------------- |
| `--mode <mode>`      | `auto` (default), `keep` or `biome`                             |
| `--engine <name>`    | The linter: `biome`, `oxlint` or `eslint`                       |
| `--formatter <name>` | The formatter: `biome` or `prettier`                            |
| `--packs <a,b>`      | Optional packs to switch on                                     |
| `--yes`              | Accept the plan without asking                                  |
| `--dry-run`          | Show the plan and change nothing                                |
| `--workflow`         | Add a GitHub Actions workflow that also keeps the doctor report |
| `--agents`           | Set up coding agents: see below                                 |
| `--hooks`            | Add a pre-commit hook that checks changed files                 |
| `--no-editor`        | Skip editor settings                                            |
| `--no-install`       | Do not run the package manager                                  |

`--agents` adds hooks that fix each edit and hand back what is left, for Claude Code, and for Cursor, Codex and Copilot where the repo uses them; instructions in `AGENTS.md`, with an import in `CLAUDE.md` and an entry in Gemini CLI's settings so those read them too; and a pawl skill. See [Coding agents](/guide/agents/#set-it-up).

## Options for doctor

| Option            | Meaning                      |
| ----------------- | ---------------------------- |
| `--format <kind>` | `pretty` (default) or `json` |

`--format json` prints the whole report as one document: the project, the policy, the tools, each tool's installed version against the versions pawl works with, the packs the files call for, and the problems. See [Troubleshooting](/guide/troubleshooting/#pawl-doctor).

## Other options

| Option            | Meaning             |
| ----------------- | ------------------- |
| `-y`              | The same as `--yes` |
| `-h`, `--help`    | Show the help       |
| `-v`, `--version` | Show the version    |

`--dry-run` also works with `add` and `migrate`, `--yes` with `migrate`, and `--no-install` with `add`.

## Options for migrate

`migrate` takes the options for `init`, and two of its own.

| Option               | Meaning                                                                     |
| -------------------- | --------------------------------------------------------------------------- |
| `--keep-config`      | Write the policy and leave the ESLint config file alone                     |
| `--extends <policy>` | Build on a policy package or file, and carry over only what differs from it |

## Exit codes

| Code | Meaning                                                |
| ---- | ------------------------------------------------------ |
| 0    | No new errors                                          |
| 1    | New errors, or more new warnings than the limit allows |
| 2    | A setup problem                                        |
