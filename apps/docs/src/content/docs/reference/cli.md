---

title: CLI
description: "Every pawl command and option: init, check, fix, sync, upgrade, add, migrate, baseline, explain and doctor, with their flags, the output for people, coding agents and editors, and exit codes."
head: [{ tag: title, content: "CLI reference: every pawl command and option | pawl" }]
---

| Command               | What it does                                                   |
| --------------------- | -------------------------------------------------------------- |
| `pawl init`           | Set up this repo                                               |
| `pawl check [files]`  | Lint, check formatting and apply the ratchet                   |
| `pawl fix [files]`    | Apply safe fixes and format                                    |
| `pawl sync`           | Rewrite engine config files from the policy                    |
| `pawl upgrade`        | Install the tool versions this pawl works with, then sync      |
| `pawl add <pack...>`  | Switch on optional packs and install their ESLint plugins      |
| `pawl migrate`        | Turn an existing ESLint config into a pawl policy, then set up |
| `pawl baseline`       | Accept the current findings as the baseline                    |
| `pawl explain <rule>` | Show what a rule does and its level here                       |
| `pawl doctor`         | Check the setup and the tool versions                          |

## Options for check and fix

| Option               | Meaning                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------- |
| `--changed`          | Only files changed against HEAD, plus untracked ones                                              |
| `--since <ref>`      | Only files changed since the branch left `<ref>`, such as `origin/main`                           |
| `--format <kind>`    | `pretty`, `agent`, `editor`, `github`, `sarif` or `json`; see [Output](#output)                   |
| `--ci`               | Also fail when the setup has drifted from the policy                                              |
| `--max-warnings <n>` | Fail when there are more than `n` new warnings                                                    |
| `--eslint-cache`     | Opt into the [deterministic ESLint cache](/guide/speed/#cache-eslint-checks); disabled by default |
| `--verbose`          | Show the engine commands that ran                                                                 |
| `--hook`             | For a coding agent's post-edit and stop hooks: see below                                          |

`[files]` are files and folders, each relative to the folder pawl runs in or absolute, as lint-staged passes them; a folder stands for every file in it, and a path outside the project is left out. Outside a git repository nothing can say what changed, so `--changed` checks every file. `--since` takes the place of `--changed` and of a list of files; see [Only what a pull request changed](/guide/ci/#only-what-a-pull-request-changed). `--ci` is on automatically when the `CI` environment variable is set, as CI services set it; an empty value, `0` and `false` mean it is not. `--max-warnings` counts only warnings the baseline does not allow, and fails with exit code 1; when the policy sets [`maxWarnings`](/reference/config/#maxwarnings), the lower limit wins.

`--hook` is for a coding agent's post-edit hook. Pawl reads the files the agent edited from the hook's input on stdin, fixes and checks those files only, and prints what is left in the shape that agent reads back. It always exits with 0 unless the check could not run; then it prints the problem to stderr and exits with 1, so the person sees it and the agent does not. It takes no list of files, `--changed`, `--since` or `--format`. See [Hooks that fix each edit](/guide/agents/#hooks-that-fix-each-edit).

In a stop hook, `--hook` checks every file the agent edited in the session, as the post-edit hook recorded them, and sends the agent back while new errors are left: at most three times in a row, and not again when a round changed nothing. See [A check before the agent finishes](/guide/agents/#a-check-before-the-agent-finishes).

## Output

Pawl picks its output for whoever runs it. `--format` chooses one outright.

| Format   | For             | What it prints                                                                                                                                         |
| -------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pretty` | People          | In a terminal: each finding with the line of code it points at and how to fix it, then a summary. In a pipe or a log: the same facts as plain lines    |
| `agent`  | Coding agents   | One JSON line per finding, errors first, with a `fix` where pawl has one, and nothing when there is nothing to do; see [Coding agents](/guide/agents/) |
| `editor` | Code editors    | One `file:line:col: error: message [rule]` line per finding, the shape problem matchers, Vim and Emacs read; see [Editors](/guide/editors/)            |
| `github` | GitHub Actions  | An annotation per finding, on its line in the pull request, then the plain report for the log; see [CI](/guide/ci/#findings-on-the-pull-request)       |
| `sarif`  | Code scanning   | SARIF 2.1.0 with the new findings, for GitHub code scanning and other tools; see [CI](/guide/ci/#code-scanning-with-sarif)                             |
| `json`   | CI, other tools | The versioned [check report](/reference/report/) as one document                                                                                       |

Without `--format`, a person gets `pretty`, a coding agent gets `agent`, and any other GitHub Actions job gets `github`, which prints the plain report after the annotations, so the log reads the same. Pawl knows an agent by the variables agents set on the commands they run: `CLAUDECODE` for Claude Code, `CURSOR_AGENT` for Cursor, `CODEX_SANDBOX` and `CODEX_THREAD_ID` for Codex, `GEMINI_CLI` for Gemini CLI, and the ones Amp, Qwen Code, Augment, Cline, OpenCode and Antigravity set, as well as the shared `AGENT` and `AI_AGENT`. An agent also gets no colors, no spinners and no questions, in every command, and the package manager's output only when an install fails.

| Variable        | Effect                                                                                                                                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PAWL_AGENT=0`  | A person is running pawl, whatever else is set, as when you type a command in an agent's own shell                                                                                                     |
| `PAWL_AGENT=1`  | An agent is running pawl                                                                                                                                                                               |
| `PAWL_FORMAT`   | The format when `--format` is not given, for a program that reads what pawl prints, such as [Quality](/guide/quality/) with `editor`. `PAWL_FORMAT=pretty` turns the annotations off in GitHub Actions |
| `NO_COLOR`      | No colors. The layout for people stays                                                                                                                                                                 |
| `FORCE_COLOR=1` | Colors, and the layout for people, even in a pipe                                                                                                                                                      |

In a terminal, `pawl` shows the commands, and `pawl <command> --help` or `pawl help <command>` shows that command's options and examples. A command or an option that is almost right gets a suggestion of the one you probably meant.

## Options for init

| Option               | Meaning                                                            |
| -------------------- | ------------------------------------------------------------------ |
| `--mode <mode>`      | `auto` (default), `keep` or `biome`                                |
| `--engine <name>`    | The linter: `biome`, `oxlint` or `eslint`                          |
| `--formatter <name>` | The formatter: `biome` or `prettier`                               |
| `--packs <a,b>`      | Optional packs to switch on                                        |
| `--yes`              | Accept the plan without asking                                     |
| `--dry-run`          | Show the plan and change nothing                                   |
| `--workflow`         | Add a GitHub Actions workflow that also keeps the doctor report    |
| `--agents`           | Set up coding agents: see below                                    |
| `--hooks`            | Add a pre-commit hook that checks changed files                    |
| `--no-baseline`      | Do not create or update a baseline; existing baselines still apply |
| `--no-editor`        | Skip editor settings and tasks                                     |
| `--no-install`       | Do not run the package manager                                     |

In a terminal, when no option says what to set up, `init` asks: how to set up the tools, then which of the editor, coding agents, a pre-commit hook and a GitHub workflow to add. The editor and coding agents start ticked. With `--yes`, or in CI or under a coding agent, it asks nothing and uses the options. The editor part is VS Code's settings, extension and tasks, and Zed's tasks where the repo has a `.zed` folder; see [Editors](/guide/editors/).

`--agents` adds hooks that fix each edit and hand back what is left, and send the agent back when it stops with errors left, for Claude Code, and for Cursor, Codex and Copilot where the repo uses them; instructions in `AGENTS.md`, with an import in `CLAUDE.md` and an entry in Gemini CLI's settings so those read them too; and a pawl skill. See [Coding agents](/guide/agents/#set-it-up).

## Options for doctor

| Option            | Meaning                      |
| ----------------- | ---------------------------- |
| `--format <kind>` | `pretty` (default) or `json` |

`--format json` prints the whole report as one document: the project, the policy, the tools, each tool's installed version against the versions pawl works with, the packs the files call for, and the problems. See [Troubleshooting](/guide/troubleshooting/#pawl-doctor).

## Options for upgrade

| Option         | Meaning                                               |
| -------------- | ----------------------------------------------------- |
| `--dry-run`    | Show the tools it would install and change nothing    |
| `--no-install` | Do not run the package manager; only sync the configs |

`pawl upgrade` installs every tool that is installed and outside the versions this pawl works with, as `pawl doctor` reports them: Biome and Oxlint at the exact version pawl pins, and ESLint, Prettier, `typescript-eslint`, `oxlint-tsgolint` and the plugins of the packs the policy names at their newest version, which is inside every range pawl declares. It uses the project's package manager, and runs `pawl sync` once the new versions are in place. A tool that is not installed is left to `pawl add` or `pawl init`, and Node to you.

## Other options

| Option            | Meaning             |
| ----------------- | ------------------- |
| `-y`              | The same as `--yes` |
| `-h`, `--help`    | Show the help       |
| `-v`, `--version` | Show the version    |

`--dry-run` also works with `add`, `migrate`, `sync` and `upgrade`, `--yes` with `migrate`, and `--no-install` with `add` and `upgrade`.

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
| 130  | Cancelled at a question; nothing was changed           |
