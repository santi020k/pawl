---
'@santi020k/pawl': minor
---

Findings in CI where people read them: GitHub annotations on the pull request, and SARIF for code scanning.

- `--format github` prints a GitHub Actions annotation for each new finding, with its file, line, column, rule and fix, so it shows on that line in the pull request. Setup problems and the warning limit show on the run, as errors in CI. The annotations sit in a log group that GitHub folds away, and the plain report follows, so the log reads as before.
- `--format sarif` prints the new findings as SARIF 2.1.0, the format GitHub code scanning and other code-scanning tools read. Each finding is a result with its rule, level and location; each rule from pawl's catalog carries its summary and its fix. Setup problems are notifications of the run, and `executionSuccessful` is false when the check could not complete. Findings the baseline allows are left out of both formats.
- Under GitHub Actions, both formats name files from the root of the repository the job checked out, also when pawl runs in a folder below it.
- The workflow `init --workflow` writes runs `pawl check --ci --format github`. A workflow written by an earlier version is left alone.
- `formatGithub` and `formatSarif` are exported for the API.
