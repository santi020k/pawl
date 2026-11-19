---

title: Troubleshooting
description: What pawl doctor checks, what each exit code means, and fixes for common setup problems.
---

Start with `pawl doctor`. Most problems below show up there first.

## pawl doctor

```sh
pawl doctor
```

It prints the setup, one line per part:

| Line       | What it shows                                                                      |
| ---------- | ---------------------------------------------------------------------------------- |
| `Project`  | What pawl detected about the repo                                                  |
| `Policy`   | The config file and what it extends, or the default standard; `strict` if set      |
| `Lint`     | The linter, and whether ESLint runs next to it for the packs                       |
| `Format`   | Biome or Prettier                                                                  |
| `Biome`    | The pinned version or `not installed`, and whether `biome.json` matches the policy |
| `Oxlint`   | When Oxlint lints: installed or not, and the state of `.oxlintrc.json`             |
| `Prettier` | When Prettier formats: installed or not, and the state of its config               |
| `ESLint`   | When ESLint runs: installed or not                                                 |
| `Packs`    | The active packs, and the ones that fit the project but are not installed          |
| `Guards`   | The guards that are on                                                             |
| `Baseline` | How many findings the baseline allows, or that there is none                       |

Then it lists each problem, or `No problems found.` A problem is:

- a tool that is in use but not installed;
- a Biome, Oxlint or Prettier config that is missing, out of date, or, for Biome, does not extend the pawl standard;
- a layer that tried to loosen a locked rule;
- a rule or pack ESLint cannot enforce, with the plugin it needs, or the reason an installed plugin failed to load.

`pawl doctor` exits with 0 when there are no problems and 2 when there are.

## Exit codes

| Command        | 0                                   | 1                              | 2                                                                 |
| -------------- | ----------------------------------- | ------------------------------ | ----------------------------------------------------------------- |
| `check`, `fix` | No new errors. Warnings alone pass. | At least one new error         | Part of the check did not run, or, with `--ci`, any setup problem |
| `baseline`     | Baseline written                    |                                | Part of the check did not run                                     |
| `init`, `add`  | Done, a dry run, or you said no     |                                | The install failed, or `init` could not record the baseline       |
| `migrate`      | As `init`                           |                                | As `init`                                                         |
| `explain`      | The rule was found                  | The rule is not in the catalog |                                                                   |
| `doctor`       | No problems                         |                                | At least one problem                                              |
| Any            |                                     |                                | An unknown command, option or option value, or any other error    |

`--ci` is on automatically when the `CI` environment variable is `true`.

## Common problems

### An engine is not installed

```txt
setup  This project is set up to run ESLint, but ESLint is not installed.
       Add eslint to devDependencies.
```

The policy, or the files in the repo, call for a tool that is not in `node_modules`. Install it with your package manager. The check exits with 2, because part of it did not run. See [Install](/guide/install/) for the packages and versions.

For Biome, install the exact version pawl pins. `pawl doctor` prints it.

### The check did not complete

```txt
The check did not complete. Fix the setup problem above and run it again.
```

An engine could not run, an engine is missing, or the Biome or Oxlint config file is missing. Pawl never reports success when part of the check did not run. Fix the `setup` line above it; `--verbose` shows the engine commands that ran.

### It passes locally but fails in CI

In CI, `--ci` is on, and any setup problem fails the run with 2, not only the ones that stop an engine. The usual cause is drift: someone edited `biome.json`, `.oxlintrc.json` or the Prettier config by hand, or changed the policy without running `pawl sync`.

```sh
pawl sync
```

Commit what it writes. In a monorepo, a package that starts using a new technology also needs `pawl sync`; see [Monorepos](/guide/monorepos/).

### biome.json does not extend the pawl standard

Biome is running with its own settings. Add `@santi020k/pawl/biome` to `extends` in `biome.json`, or run `pawl sync`.

### A disable comment fails the check

A file that gains `biome-ignore`, `eslint-disable`, `@ts-ignore`, `@ts-expect-error` or `@ts-nocheck` fails with `pawl/no-new-disable`. Fix the code instead. Existing comments are part of the [baseline](/guide/ratchet/), so only new ones fail.

### Old findings fail the check

With no baseline, every finding counts. The output says so:

```txt
No baseline yet. Run "pawl baseline" to accept existing findings and fail only on new ones.
```

Run `pawl baseline` and commit `.pawl/baseline.json`.

When a file goes over its count for a rule, every finding of that rule in the file is shown, because counts are per file and rule. Fix the new one, and the rest are allowed again. See [The ratchet](/guide/ratchet/#why-per-file-and-rule).

### A locked rule cannot be loosened

```txt
setup  "no-console" is locked at "error" by the policy this repo extends. pawl.config.ts tried to set it to "off".
       Remove the "no-console" override from pawl.config.ts.
```

The policy this repo extends locks the rule. The stricter level is kept. Remove the override. See [A company standard](/guide/policy/#a-company-standard).

### A pack does not run

A pack needs ESLint and its plugin. `pawl doctor` lists packs that fit the project but are not installed, with the `pawl add` command for them, and rules that are wanted but cannot run, with the package each needs. A rule the installed plugin does not have is left out, so an older plugin does not break the run.

### Guards with Oxlint

With Oxlint as the only linter, the guards' code patterns do not run; only their import restrictions do. `pawl doctor` says so on the `Guards` line. Run ESLint next to Oxlint, or lint with Biome. See [Guards](/guide/guards/).

### pawl explain does not know a rule

`pawl explain` covers the rules in the pawl catalog and pawl's Docker checks. For any other engine rule it exits with 1 and points you to that engine's documentation.
