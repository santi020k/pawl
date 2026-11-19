---

title: CI and hooks
description: Run pawl in GitHub Actions and before each commit.
---

## In CI

```sh
pawl check --ci
```

`--ci` also fails when the setup has drifted from the policy, for example when someone edited `biome.json` by hand instead of changing the policy and running `pawl sync`. It is on automatically when the `CI` environment variable is `true`, which most CI services set.

| Exit code | Meaning                                                                                       |
| --------- | --------------------------------------------------------------------------------------------- |
| 0         | No new errors                                                                                 |
| 1         | New errors                                                                                    |
| 2         | A setup problem: an engine could not run, or, with `--ci`, the config drifted from the policy |

Pawl never reports success when part of the check did not run: an engine failure is a setup problem, exit code 2.

### GitHub Actions

`init --workflow` writes `.github/workflows/pawl.yml`. For an npm project it looks like this:

```yaml title=".github/workflows/pawl.yml"
name: pawl

on:
  pull_request:
  push:
    branches: [main]

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npx pawl check --ci
```

For pnpm and yarn it enables Corepack and installs with `--frozen-lockfile`; for Bun it adds `oven-sh/setup-bun`. If the workflow file already exists, `init` leaves it alone.

## Before each commit

`init --hooks` adds a pre-commit hook that runs:

```sh
npx pawl check --changed
```

It uses the hook manager the repo already has:

| The repo uses | What pawl does                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------ |
| husky         | Adds the command to `.husky/pre-commit`                                                          |
| lefthook      | Tells you to add the command to the pre-commit commands in your lefthook file                    |
| Neither       | Writes `.git/hooks/pre-commit`, which is local to this clone. Use husky or lefthook to share it. |

If a plain git pre-commit hook already exists, pawl does not touch it and tells you which command to add.
