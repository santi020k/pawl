---
'@santi020k/pawl': patch
---

The pre-commit hook `init --hooks` writes no longer fails a commit for a file that is not in it. `pawl check --changed` looks at the files changed against HEAD and the untracked ones, so an untracked file with a finding, even one only to format, stopped every commit until it was deleted or fixed. While git runs the hooks of a commit, `--changed` now takes the files the commit changes, from the index git commits; a change that is not staged is left out too. Hooks written by an earlier version get this without a change.
