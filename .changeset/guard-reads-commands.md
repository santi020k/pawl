---
'@santi020k/pawl': patch
---

The guard before each tool reads a shell command for what it runs and what it writes, instead of looking for words in its text. Codex no longer refuses a command that only reads the baseline, such as `cat .pawl/baseline.json 2>&1`, `jq … .pawl/baseline.json > out.json` or `cp .pawl/baseline.json /tmp/`, or one that only mentions pawl and its baseline in a string, such as a commit message or a search. It now catches what got past it: `sed --in-place` and `perl -pi`, `pawl baseline` inside `bash -c` or `$(…)`, a command split over lines, a Node or Python script that writes the baseline, an `apply_patch` run from the shell, a command that removes or restores the `.pawl` folder, and PowerShell's `Set-Content`, `Out-File`, `Copy-Item` and `Remove-Item` with Windows paths. Claude Code also asks before a command writes the policy or an engine config, as it does before an edit of one.

The guard now covers the whole repository when the agent works in a package of a monorepo: an edit of the baseline or the policy at the top of the repository asked nobody when the hook started in the package's folder. `init --agents` also adds `PowerShell` to the tools the guard runs before in Claude Code, which on Windows runs its shell commands there, and without Git Bash only there.
