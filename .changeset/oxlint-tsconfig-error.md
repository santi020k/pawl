---
'@santi020k/pawl': patch
---

When Oxlint's tsgolint cannot read the project's `tsconfig.json`, as with a syntax error or an `extends` that names a missing file, `pawl check` stops with a setup problem and exit code 2 that names the file. Oxlint reports that as one diagnostic and runs none of the rules that need type information, so it used to be an ordinary finding, which `pawl baseline` could accept while those rules stayed off.
