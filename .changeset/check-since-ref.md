---
"@santi020k/pawl": minor
---

`pawl check --since <ref>` and `pawl fix --since <ref>` look only at the files the branch changed since it left `<ref>`, such as `origin/main`: its commits, what is not committed yet, and untracked files. It is the pull request mode for CI, and a way to bring a large repo under the standard one pull request at a time. When git does not know the ref, or the clone is too shallow to join it to the branch, the check stops with exit code 2 and the new `since-unresolved` setup problem. The library takes the same as `since` in the options of `check`.
