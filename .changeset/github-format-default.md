---
'@santi020k/pawl': minor
---

In a GitHub Actions job, `pawl check` and `pawl fix` use `--format github` when no format is given, so a workflow written by an earlier version also puts each new finding on its line in the pull request. The plain report still follows the annotations in the log. A coding agent that runs pawl in GitHub Actions still gets `agent`, `--format` and `PAWL_FORMAT` still win, and `PAWL_FORMAT=pretty` turns the annotations off.
