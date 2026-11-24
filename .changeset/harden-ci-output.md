---
'@santi020k/pawl': patch
---

Harden GitHub Actions and SARIF CI output against path-normalization, URI-encoding, and log-command injection bugs:

- Percent-encode SARIF `artifactLocation.uri` path segments (including `#`, `?`, `%`, spaces, brackets, backslashes, and Unicode) while keeping `/` separators intact.
- Neutralize both `::` and legacy `##[` GitHub Actions workflow-command syntaxes in the human report appended after `--format github` annotations.
- Strip redundant leading `./` and `/` separators (and bare `.`) when normalizing relative `base` and finding paths so dot-prefixed folders such as `.config` and `.github` keep their leading dot without altering literal-backslash filenames.
