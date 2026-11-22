---
"@santi020k/pawl": patch
---

With Oxlint as the linter, pawl now keeps Oxlint out of `node_modules` in every project. Oxlint skips that folder only where a `.gitignore` lists it, so in a project without one, such as a folder that is not a git repository or a package whose `.gitignore` is further up, `pawl fix` rewrote the files of installed packages, and every check linted them. `.oxlintrc.json` now names `node_modules` and `.git` itself. Run `pawl sync` to update it.
