---
'@santi020k/pawl': minor
---

Hooks that fix each edit and hand what is left back to the agent, for more agents.

- `pawl fix --hook` runs from a coding agent's post-edit hook. It reads the files the agent edited from the hook's input, fixes and checks only those files, and answers in the shape that agent reads back: `hookSpecificOutput.additionalContext` for Claude Code and Codex, `additionalContext` for Copilot, and nothing for Cursor, which reads nothing back. When the check cannot run, the problem goes to stderr with exit code 1, for the person and not the agent. `pawl check --hook` reports without fixing.
- The Claude Code hook that `init --agents` writes now runs `npx pawl fix --hook`. The old hook ran `pawl check --changed --format agent`, and Claude Code does not show the model a hook's plain output, so Claude never saw the findings. The Cursor hook now fixes only the files the agent edited, not every changed file. Running `init --agents` again swaps the old commands for the new one in place.
- `init --agents` adds a Codex hook to `.codex/hooks.json` in repos with a `.codex` folder, and a Copilot hook to `.github/hooks/pawl.json` in repos that use Copilot.
- Claude Code reads `CLAUDE.md`, not `AGENTS.md`, so `init --agents` adds an `@AGENTS.md` import to `CLAUDE.md`, or writes a `CLAUDE.md` that has one. In a repo with a `.gemini` folder, it adds `AGENTS.md` to the files Gemini CLI reads.
- `init --agents` writes a pawl skill to `.claude/skills/pawl/SKILL.md` and `.agents/skills/pawl/SKILL.md`: what to run after an edit, how to read the findings, and what not to do.
- The `AGENTS.md` block also tells agents not to run `pawl baseline` to make findings go away.
