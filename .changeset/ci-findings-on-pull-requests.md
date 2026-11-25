---
'@santi020k/pawl': minor
---

Findings show where people read them in CI: on their line in the pull request, and in code scanning.

- `--format github` prints a GitHub Actions annotation for each new finding, with its file, line, column, rule and fix, so it shows on that line in the pull request. Setup problems and the warning limit show on the run; in CI every setup problem is an error. The annotations sit in a log group that GitHub folds away, and the plain report follows, so the log reads as before.
- In a GitHub Actions job, `pawl check` and `pawl fix` now use `--format github` when no format is given, so a workflow written by an earlier version also puts each new finding on its line in the pull request. A coding agent that runs pawl there still gets `agent`, and `--format` and `PAWL_FORMAT` still win. If a step reads what pawl prints, name the format it reads, or set `PAWL_FORMAT=pretty` on the step for the plain report alone.
- `--format sarif` prints the new findings as SARIF 2.1.0, the format GitHub code scanning and other code-scanning tools read. Each finding is a result with its rule, level and location, and each rule from pawl's catalog carries its summary and its fix. Setup problems are notifications of the run, and `executionSuccessful` is false when the check could not complete. Upload the file with `github/codeql-action/upload-sarif`; the [CI guide](https://pawl.santi020k.com/guide/ci/#code-scanning-with-sarif) has the steps and the permissions.
- Findings the baseline allows are left out of both formats.
- Under GitHub Actions, both formats name files from the root of the repository the job checked out, also when pawl runs in a folder below it. SARIF percent-encodes the characters a URI cannot hold, such as spaces, `#` and `?`, and the plain report after the annotations cannot start a workflow command, whatever a finding's message says.
- The workflow `init --workflow` writes runs `pawl check --ci --format github`.
- The API gains `formatGithub`, `formatSarif` and the `CiOutputOptions` type. `OutputFormat` takes `github` and `sarif`, and `format` takes the `ci` and `base` options. Nothing is removed, but code that handles every `OutputFormat` by name needs a case for the two new ones.
