---

title: Editors
description: "Pawl in your editor: VS Code tasks that put findings in the Problems panel, Zed tasks, format on save, and --format editor lines for Vim, Emacs and any problem matcher."
head: [{ tag: title, content: "Editors: pawl in VS Code, Zed, Vim and Emacs | pawl" }]
---

<!-- cspell:ignore makeprg trror tarning -->

`pawl init` sets up the editor along with the tools, unless you pass `--no-editor`. Every editor can also read pawl's findings through `--format editor`.

## VS Code

`init` writes three files in `.vscode`:

| File              | What it holds                                                                                |
| ----------------- | -------------------------------------------------------------------------------------------- |
| `settings.json`   | Format on save with Biome or Prettier; with Biome, also its fixes and import sorting on save |
| `extensions.json` | A recommendation for the Biome or Prettier extension                                         |
| `tasks.json`      | Two tasks, `pawl: check` and `pawl: fix`, whose findings go to the Problems panel            |

Run a task with **Tasks: Run Task** from the command palette. `pawl: check` runs the whole check, ratchet included, and each new finding shows up in the Problems panel and as a squiggle in the file. `pawl: fix` applies the safe fixes and formatting first, then lists what is left. Click a problem to jump to its line.

The tasks run `npx --no pawl check --format editor`, and a problem matcher reads its lines:

```json
{
  "label": "pawl: check",
  "type": "shell",
  "command": "npx --no pawl check --format editor",
  "problemMatcher": {
    "owner": "pawl",
    "source": "pawl",
    "fileLocation": ["relative", "${workspaceFolder}"],
    "pattern": {
      "regexp": "^(.+?):(\\d+):(\\d+): (error|warning|info): (.*) \\[([^\\]]+)\\]$",
      "file": 1,
      "line": 2,
      "column": 3,
      "severity": 4,
      "message": 5,
      "code": 6
    }
  }
}
```

The severity takes `info` as well, so the same matcher reads the `--format editor` lines of [Quality](/guide/quality/), which prints them too.

Pawl does not overwrite a `tasks.json` you already have. It adds the tasks it does not find by label, so a `pawl: check` task of your own stays as you wrote it. A file with comments is left alone, with a note to add the task by hand.

## Zed

Where the repo has a `.zed` folder, `init` adds `pawl: check` and `pawl: fix` to `.zed/tasks.json`. Run them with **task: spawn**. Zed does not read problems from a task, so these run pawl's view for people in Zed's terminal. Each `file:line:col` there opens the file at that line, and both tasks save every file first, so pawl checks what you see.

## Any editor: `--format editor`

```sh
pawl check --format editor
```

One line per finding, in the shape compilers print:

```text
src/billing.ts:1:20: error: Dependency stripe-lite isn't specified in package.json. [biome:correctness/noUndeclaredDependencies]
src/billing.ts:3:32: warning: Unexpected any. Specify a different type. [biome:suspicious/noExplicitAny]
```

The rule at the end is the same name `--format agent` gives, so `pawl explain` takes it as it is. A setup problem has no file, so its line starts with `pawl:` instead, such as `pawl: error: No biome.json found.`; a problem matcher that wants a file leaves it out, and the exit code still says the check did not run.

Editors that read compiler output pick these lines up as they are:

- **Vim and Neovim:** `:set makeprg=npx\ --no\ pawl\ check\ --format\ editor`, then `:make` fills the quickfix list. The default `errorformat` reads `file:line:col: message`; add `%f:%l:%c:\ %trror:\ %m,%f:%l:%c:\ %tarning:\ %m` in front of it to keep errors and warnings apart.
- **Emacs:** `M-x compile` with `npx --no pawl check --format editor`. Compilation mode reads the lines, and `next-error` walks them.
- **Anything else with a problem matcher or an error regex:** the pattern above reads the file, line, column, severity, message and rule, in that order.

## In the terminal

In a terminal, `pawl check` shows each finding with the line of code it points at, a mark under the part it means, and how to fix it. In the terminals of VS Code, Zed and other editors, Cmd- or Ctrl-click a `file:line:col` to open the file there. A coding agent running in the same terminal gets [its own format](/guide/agents/#output-for-agents) instead.
