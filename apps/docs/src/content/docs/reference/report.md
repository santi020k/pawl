---

title: JSON report
description: "Consume Pawl check reports safely: validate the version, findings and setup problems together with the process exit code, without hiding failed checks."
---

Use `pawl check --format json` for CI integrations and editor adapters. It writes one JSON document to standard output. Starting with Pawl 0.5, `reportVersion: 1` identifies this contract. The existing result fields remain at the top level; adapters that read `findings` and `setup` do not need a new wrapper.

`--format agent` is compact JSON per line for coding agents. It is a different format. There is no `PAWL_FORMAT=editor` interface.

## Read the report and the exit code together

```ts
import { spawnSync } from 'node:child_process'
import { readCheckReport } from '@santi020k/pawl'

const child = spawnSync('pawl', ['check', '--ci', '--format', 'json'], {
  encoding: 'utf8'
})
const outcome = readCheckReport(child.stdout ?? '', child.status, { ci: true })

if (outcome.status === 'invalid') {
  throw new Error(`Pawl did not return a valid report: ${outcome.message}`)
}

if (outcome.status === 'setup') {
  // Show setup messages separately. This check did not pass.
  process.exitCode = 2
} else {
  // Render outcome.report.findings, including warnings when exitCode is zero.
  process.exitCode = outcome.exitCode
}
```

The consumer must pass the same CI mode as the invocation: `--ci` or an enabled `CI` environment makes all setup drift fatal. An engine failure is always fatal, in either mode. Capture standard error separately for errors that happen before Pawl can create a report, such as invalid options or policy syntax. A signal, launch failure, empty output, truncated JSON, unsupported report version or exit-code mismatch produces `status: 'invalid'`; treat it as an operational failure, never a clean check.

| Process exit | Meaning                                                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `0`          | The run completed without new errors or excess warnings. Warnings and advisory setup drift can still be present outside CI.          |
| `1`          | New errors exist, or the number of new warnings exceeds `maxWarnings`.                                                               |
| `2`          | A blocking setup problem prevented a complete check, or CI rejected setup drift. Pre-report failures can also exit `2` without JSON. |

`readCheckReport` returns `ok`, `findings` or `setup` with a typed `CheckReport`, or `invalid` with a diagnostic. `ok` means the process met its configured exit policy; it does not mean that the findings and setup arrays are empty. The parser validates the complete report and rejects contradictory baseline/completion state. It ignores additional fields within version 1, but refuses unknown versions and setup codes instead of guessing whether they are safe.

## Version 1 fields

| Field               | Contract                                                                                                                                                                                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reportVersion`     | Integer `1`. Unversioned reports from older Pawl releases require a separately qualified legacy adapter.                                                                                                                                                                                                      |
| `findings`          | New findings after baseline filtering. Each contains `file`, positive `line` and `column`, `engine`, `engineRule`, `rule`, `severity` (`warn` or `error`), `message`, and boolean `fixable`. Optional `overBaseline` contains nonnegative integer `allowed` and `found`, with `found` greater than `allowed`. |
| `setup`             | Setup issues with `code`, `message`, and optional `fix`. These are not code findings and must never be recorded as baseline allowances.                                                                                                                                                                       |
| `baselined`         | Nonnegative integer count of existing code findings hidden by the baseline. It cannot make a setup failure successful.                                                                                                                                                                                        |
| `engines`           | Names of the active linters and language tools reported by the check.                                                                                                                                                                                                                                         |
| `commands`          | Human-readable engine commands. Do not execute these strings as part of consuming the report.                                                                                                                                                                                                                 |
| `hasBaseline`       | Whether a baseline exists.                                                                                                                                                                                                                                                                                    |
| `canShrinkBaseline` | Whether a complete full check found room to shrink it. False for a blocked check.                                                                                                                                                                                                                             |
| `nothingToCheck`    | Whether the selected scope contained no files. It does not override setup errors.                                                                                                                                                                                                                             |
| `maxWarnings`       | Optional nonnegative integer limit. Omitted means warnings alone do not fail the check.                                                                                                                                                                                                                       |

Keep fixtures for success, warnings, errors, warning-limit failure, setup failure and malformed output in downstream consumers. Test each supported Pawl report version explicitly. This repository's contract tests also capture the real CLI with Biome findings, a failed engine and a pre-report usage error. Quality's `pawl-json` integration should be verified against its own released version before claiming that an upgrade is deployed there.
