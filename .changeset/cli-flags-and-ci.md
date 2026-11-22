---
"@santi020k/pawl": patch
---

`pawl fix` reads every option before it runs, so a mistyped `--format` or `--max-warnings` no longer changes files first and then stops with an error. `--ci` is on for any value of the `CI` environment variable but an empty one, `0` and `false`: services that set `CI=1` used to run without it, so drift from the policy passed there. Outside a git repository, `--changed` checks every file instead of none; it used to print "No files to check" and pass.
