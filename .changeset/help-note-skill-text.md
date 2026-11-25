---
'@santi020k/pawl': patch
---

`check --help` says that `--hook` is also the stop hook and the guard before each tool, and that `pretty` is the default except for a coding agent, which gets `agent`, and in GitHub Actions, which gets `github`. `init --workflow` says the workflow runs `pawl check --ci --format github`, as the file it writes does. The skill `init --agents` writes, and the plugin's, say that Claude Code asks before `pawl baseline` and Codex refuses it, and that retries, raised timeouts and fixed sleeps in a test fail the check too.
