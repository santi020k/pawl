---

title: CI and hooks
description: "Run pawl in CI and before each commit: --ci fails on new findings and on config drift, findings show on the pull request and in code scanning, and init can write a GitHub Actions workflow and a pre-commit hook."
head: [{ tag: title, content: "CI and hooks: GitHub Actions and pre-commit | pawl" }]
---

## In CI

```sh
pawl check --ci
```

`--ci` also fails when the setup has drifted from the policy, for example when someone edited `biome.json` by hand instead of changing the policy and running `pawl sync`. It is on automatically when the `CI` environment variable is set, which CI services do: `true`, `1` and any other value count, except an empty one, `0` and `false`.

| Exit code | Meaning                                                                                       |
| --------- | --------------------------------------------------------------------------------------------- |
| 0         | No new errors                                                                                 |
| 1         | New errors, or more new warnings than the limit allows                                        |
| 2         | A setup problem: an engine could not run, or, with `--ci`, the config drifted from the policy |

Pawl never reports success when part of the check did not run: an engine failure is a setup problem, exit code 2.

### Warnings in CI

Warnings pass by default. To fail on them in CI only, put the limit in the CI command:

```sh
pawl check --ci --max-warnings 0
```

To fail on them everywhere, set [`maxWarnings`](/reference/config/#maxwarnings) in the policy. A command line can lower that limit but not raise it. Pawl has no setting that behaves one way locally and another in CI: the place that runs CI is the place to say what CI demands.

### Only what a pull request changed

```sh
pawl check --ci --since origin/main
```

`--since <ref>` checks only the files the branch changed since it left `<ref>`: its commits, plus anything not committed yet. What `<ref>` gained afterwards is left out. Use it when a full run is too slow for every pull request, or to bring a large repo under the standard one pull request at a time.

It needs the history that joins the branch to `<ref>`. In GitHub Actions, check out with `fetch-depth: 0` and pass the base branch:

```yaml
- uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
  with:
    fetch-depth: 0
- run: npx --no pawl check --ci --since "origin/$BASE_REF"
  env:
    BASE_REF: ${{ github.base_ref }}
```

A check with `--since` also fails when the branch's [baseline allows more](/guide/ratchet/#a-baseline-that-allows-more) than the one on `<ref>`, unless a commit on the branch has a `Pawl-Baseline: accept` trailer.

When git does not know the ref, or the clone is too shallow to join it to the branch, the check stops with exit code 2. It never falls back to checking nothing.

The scope is whole files, not changed lines. A file the pull request touches is checked in full, and the [baseline](/guide/ratchet/) still allows the findings it already had. A partial run cannot see findings in files the branch did not touch, so keep a full `pawl check --ci` on the main branch.

A pull request that touches thousands of files is checked too. When the list is too long for one command line, pawl runs each engine several times on part of it, one run after the other, and `--verbose` shows the command once with the number of files and runs.

### GitHub Actions

`init --workflow` writes `.github/workflows/pawl.yml`. It runs the check with [annotations](#findings-on-the-pull-request), then `pawl doctor --format json` and uploads its report as the `pawl-doctor` artifact, so the tool versions and any drift are on record even when the check fails. Every action is pinned to a commit. For an npm project it looks like this:

```yaml title=".github/workflows/pawl.yml"
name: pawl

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version: 22
      - run: npm ci
      - run: npx --no pawl check --ci --format github
      - name: Check the setup and the tool versions
        if: always()
        run: npx --no pawl doctor --format json > pawl-doctor.json
      - name: Upload the doctor report
        if: always()
        uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2
        with:
          name: pawl-doctor
          path: pawl-doctor.json
          if-no-files-found: warn
```

The doctor step fails the job when it finds a problem, such as a Biome other than the pinned one or a tool older than pawl supports.

For pnpm and yarn it enables Corepack and installs with `--frozen-lockfile`; for Bun it adds `oven-sh/setup-bun`. If the workflow file already exists, `init` leaves it alone. A workflow written by an earlier version gets the annotations too: in GitHub Actions, `pawl check` uses `--format github` when no format is given.

### Findings on the pull request

```sh
pawl check --ci --format github
```

`--format github` prints a GitHub Actions annotation for each new finding, with its file, line, column, rule and fix, so it shows on that line in the pull request's changed files. Setup problems and the warning limit show on the run, and in CI every setup problem is an error. The annotations sit in a group the log folds away, and the plain report follows, so the log reads as it always did. GitHub turns at most 10 errors and 10 warnings of a step into annotations; the log keeps every finding. Findings the baseline allows get none.

`pawl check` and `pawl fix` pick `--format github` on their own in a GitHub Actions job (`GITHUB_ACTIONS=true`) when neither `--format` nor `PAWL_FORMAT` names a format, unless a coding agent runs them there, which gets `agent`. This is new in 0.6: before, such a job got `pretty`. If a step reads what pawl prints, give it the format it reads, or set `PAWL_FORMAT=pretty` on the step to go back to the plain report alone.

When pawl runs in a folder below the root of the repository, the annotations name files from the root, as GitHub reads them, using the `GITHUB_WORKSPACE` folder the job checked out.

### Code scanning with SARIF

```sh
pawl check --ci --format sarif > pawl.sarif
```

`--format sarif` prints the new findings as [SARIF 2.1.0](https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html), the format GitHub code scanning and other code-scanning tools read. Each finding is a result with its rule, level and location, and each rule from pawl's catalog carries its summary and how to fix it. Setup problems are notifications of the run, and a run that could not complete says so. Upload the file even when the check fails, since it exits with 1 whenever it finds a new error:

```yaml
permissions:
  contents: read
  security-events: write
  actions: read # only for a private repository

steps:
  # ...checkout, setup and install as above
  - run: npx --no pawl check --ci --format sarif > pawl.sarif
  - uses: github/codeql-action/upload-sarif@v4
    if: always()
    with:
      sarif_file: pawl.sarif
      category: pawl
```

Uploading needs `security-events: write`, and a private repository also needs `actions: read`. `category` keeps pawl's results apart from those of other tools on the same commit. Pin the action to a commit, as the workflow `init` writes does. On GitHub, code scanning is free for public repositories; a private one needs GitHub Code Security. Annotations need neither.

## Before each commit

`init --hooks` adds a pre-commit hook that runs:

```sh
npx --no pawl check --changed
```

It uses the hook manager the repo already has:

| The repo uses | What pawl does                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------ |
| husky         | Adds the command to `.husky/pre-commit`                                                          |
| lefthook      | Tells you to add the command to the pre-commit commands in your lefthook file                    |
| Neither       | Writes `.git/hooks/pre-commit`, which is local to this clone. Use husky or lefthook to share it. |

If a plain git pre-commit hook already exists, pawl does not touch it and tells you which command to add.

With lint-staged, give it the command and it adds the staged files, which pawl takes by absolute path:

```json title="package.json"
{ "lint-staged": { "*": "pawl check" } }
```
