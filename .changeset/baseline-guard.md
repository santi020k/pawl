---
'@santi020k/pawl': minor
---

A guard on what the check allows, for coding agents and for CI.

- `init --agents` adds a hook before each tool, `PreToolUse`, for Claude Code and Codex. Before an agent edits `.pawl/baseline.json`, the policy or an engine config, runs `pawl baseline`, or runs a command that writes the baseline, Claude Code asks the person, with what the call would change. Codex cannot ask yet, so it refuses a change to the baseline and says why, and lets the rest through. The hook runs `npx --no pawl check --hook`, the stop hook's command: pawl reads which event it is from the hook's input. It loads no project and runs no engine, so other tool calls go through at once. Running `init --agents` again adds it next to the hooks pawl already wrote. Copilot gets no guard: it refuses a tool when a hook before it fails, as `npx --no pawl` does in a clone before the install. The guard still reads Copilot's own payload for a hook set up by hand.
- `pawl check --since <ref>` fails with `pawl/no-baseline-growth` when `.pawl/baseline.json` allows more than it does where the branch left `<ref>`: more findings or disable comments, fewer assertions or more skipped tests, or a test file it no longer counts. A person accepts it with a `Pawl-Baseline: accept` trailer on any commit of the branch.
