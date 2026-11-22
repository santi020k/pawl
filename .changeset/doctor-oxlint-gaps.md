---
"@santi020k/pawl": patch
---

`pawl doctor` now lists the rules of the standard that Oxlint does not enforce, in the text report and under `engines.oxlint.notEnforced` in the JSON report. Before, it said "No problems found." while those rules ran nowhere. The rules that need type information are a problem, with the package that brings them (`oxlint-tsgolint`). Rules Oxlint has no equivalent for are listed on their own line and do not fail the report. A rule that ESLint takes beside Oxlint is not listed.
