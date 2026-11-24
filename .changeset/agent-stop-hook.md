---
'@santi020k/pawl': minor
---

A check when the coding agent stops, which sends it back while new errors are left.

- `init --agents` adds a stop hook next to each edit hook: `Stop` in `.claude/settings.json` and `.codex/hooks.json`, `agentStop` in `.github/hooks/pawl.json`, and `stop` in `.cursor/hooks.json`. It runs `npx --no pawl check --hook`.
- `pawl check --hook` and `pawl fix --hook` read a stop event from the hook's input. They check every file the agent edited in the session, as the edit hook recorded them, and not the rest of the working tree. While new errors are left, they send the agent back with the list: `{ "decision": "block", "reason": ... }` for Claude Code, Codex and Copilot, and `followup_message` for Cursor. Warnings do not, unless there are more than the limit allows.
- Pawl sends the agent back at most three times in a row, and not again when a round changed nothing. Then it lets the agent stop and tells the person how many problems are left: as a `systemMessage` for Claude Code, Codex and Copilot, and on stderr for Cursor. A turn the person cancelled in Cursor is not sent back.
- Cursor reads nothing back from its edit hook, so the stop hook is how what is left reaches a Cursor agent at all.
- The edit hook records the files of each session in the system's temporary folder, by the `session_id`, `sessionId` or `conversation_id` the hook's input carries. Once the agent is done, the session's edits are forgotten, so the next turn starts clean.
- The pawl skill says what the stop hook asks of the agent: fix what it lists, or say so and stop when a problem needs the user.
