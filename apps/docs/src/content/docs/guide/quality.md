---

title: With Quality
description: "Keep lint, formatting and the baseline in Pawl. Add Quality when you need type checks, tests, builds and other repository checks in the same workflow."
head: [{ tag: title, content: "Run pawl with Quality | pawl" }]
---

Pawl handles **lint and formatting policy, findings and the baseline**. [Quality](https://quality.santi020k.com) coordinates **repository validation**: analyzers plus the type checks, tests, builds and other commands you configure in `quality.yml`.

Use Pawl on its own when that covers your workflow. Add Quality when you want one entry point for the wider repository gate. Quality is optional; it does not replace Pawl's policy or baseline.

## Choose by the job

| You need                                                                         | Use                                                                        |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Lint and formatting policy, safe fixes, and a baseline that blocks new findings  | Pawl                                                                       |
| The same baseline and report for supported Rust, Swift and Kotlin tools          | Pawl with [`languages`](/guide/languages/)                                 |
| A workflow that also runs type checks, tests, builds and other repository checks | [Quality](https://quality.santi020k.com), with explicit adapters and tasks |
| Both policy enforcement and a wider validation gate                              | Pawl as a Quality task, with one owner for each check                      |

The boundary is the job, not the programming language. Pawl can run supported native tools as well as JavaScript engines. Quality can coordinate a JavaScript-only repository just as it can a mixed repository. Neither needs to run a check the other already owns.

## Run Pawl as part of the gate

This task configuration works with released Quality 2.1. Install Pawl and its chosen tools in the repository first, then add a task:

```yaml title="quality.yml"
version: 1
tasks:
  pawl:
    name: Pawl lint and formatting
    command: pnpm
    args: [exec, pawl, check]
    parser: generic
    required: true
```

`quality check` runs Pawl alongside the other configured checks. A nonzero Pawl exit fails the task. The generic parser does not provide Pawl-specific structured diagnostics.

There is deliberately no file-extension filter here: Pawl may own native-language checks, Markdown and Docker checks as well as JavaScript. A JavaScript-only filter could skip that work during a changed-file run.

A tool that runs Pawl and reads what it prints can set `PAWL_FORMAT` instead of passing `--format`. With `PAWL_FORMAT=editor`, Pawl prints one `file:line:col: error: message [rule]` line per finding, the same lines VS Code problem matchers read; `--format` still wins when both are given. Pawl and Quality recognise a coding agent by the same environment variables, and `PAWL_AGENT=0` or `1` settles it for Pawl when the guess is wrong.

:::note
The integration is in beta. Structured Pawl diagnostics use the `pawl-json` task parser introduced in Quality 2.2; the example above stays compatible with Quality 2.1. Use the integration documentation for your installed Quality version. A dedicated Pawl adapter remains planned.
:::

Add tasks for commands your repository actually defines. For example, if `package.json` has `typecheck`, `test` and `build` scripts, add these alongside the `pawl` task:

```yaml title="Additional entries under tasks"
typecheck:
  name: Type checks
  command: pnpm
  args: [run, typecheck]
  required: true
tests:
  name: Tests
  command: pnpm
  args: [run, test]
  required: true
build:
  name: Build
  command: pnpm
  args: [run, build]
  required: true
```

Quality runs independent tasks concurrently. If tests need a build first, use a repository script that orders them correctly and configure that script as one task. If an existing gate already includes Pawl, configure the gate instead of adding a second Pawl task.

## Keep one owner for each check

### JavaScript engines

Pawl runs its engines and compares findings with `.pawl/baseline.json`. Running the engines again through Quality would duplicate the check and could fail on findings the baseline allows.

Quality treats a repository as Pawl-managed when any of these is true:

- a `package.json` depends on `@santi020k/pawl`
- a package script runs `pawl`
- a `pawl.config.{ts,mts,js,mjs,json}` file exists

It then stops automatically detecting Biome, Oxlint, ESLint and Prettier, even when their config files are present. In a monorepo this applies to every workspace. An adapter you explicitly enable in `quality.yml` still runs, so remove that duplicate check or set `check: false` when Pawl owns it.

### Native-language tools

The automatic handoff covers those four JavaScript adapters only. For Clippy, rustfmt, SwiftLint, SwiftFormat and ktlint, choose the owner explicitly:

- **Pawl owns the check and baseline.** Enable the language in Pawl's policy and disable the matching Quality adapter's check.
- **Quality owns the check.** Leave that language out of Pawl's `languages` policy, or set it to `false` if an inherited policy enables it.

For example, when Pawl checks Rust, add this beside `tasks` in `quality.yml`:

```yaml title="Rust checks owned by Pawl"
tools:
  cargo-clippy:
    check: false
  cargo-fmt:
    check: false
```

Apply the same ownership decision to `swiftlint`, `swiftformat` and `ktlint` when Pawl checks them. `check: false` only disables Quality's check path; configure formatting and fixes separately if you use `quality format` or `quality fix`.

See [Pawl's native-language setup](/guide/languages/#with-quality) and [Quality's Pawl integration](https://quality.santi020k.com/adapters/#pawl-integration-beta) for the tool-specific details.
