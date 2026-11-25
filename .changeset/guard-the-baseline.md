---
'@santi020k/pawl': minor
---

A guard on the baseline, so neither a coding agent nor a branch can make the check allow more without a person deciding it.

- `init --agents` adds a hook that runs before each tool, `PreToolUse`, for Claude Code and Codex. When the agent is about to edit `.pawl/baseline.json`, the policy or an engine config, run `pawl baseline`, or run a command that writes the baseline, Claude Code asks you first and shows what the call would change. Codex cannot ask yet, so the hook refuses a change to the baseline, says why, and lets an edit to the policy or an engine config through. Run `pawl init --agents` again to add the hook next to the ones pawl already wrote.
- The hook runs `npx --no pawl check --hook`, the stop hook's command: pawl reads which event it is from the hook's input. It loads no project and runs no engine, so a tool call that changes none of those files goes through at once.
- Copilot and Cursor get no guard. Copilot refuses a tool when a hook before it fails, as `npx --no pawl` does in a clone before the install, so the guard would stop every tool there. Cursor has no hook before an edit that can ask. `pawl check --hook` still reads Copilot's own `preToolUse` input, for a hook you set up by hand.
- `pawl check --since <ref>` also fails with `pawl/no-baseline-growth` when `.pawl/baseline.json` allows more than it does where the branch left `<ref>`: more findings or disable comments in a file, fewer assertions, more skipped tests or more retries, raised timeouts and fixed sleeps in a test file, or a test file it no longer counts. A branch that records its first baseline counts too. To accept it, a person adds a `Pawl-Baseline: accept` trailer to any commit on the branch. Set the rule to `off` in the policy to turn it off.
