---
"@santi020k/pawl": patch
---

A pnpm workspace whose `packages` list has no indent, or is a flow list such as `[apps/*, packages/*]`, on one line or over several, is read as a monorepo. Pawl saw a single package there, so it missed the technologies of the packages and gave none of them a Biome config of its own. Workspace patterns with a wildcard inside a name, such as `plugins/plugin-*`, with `**` at any depth, with braces or classes, and with a leading `!` are followed as pnpm follows them. The root is never one of the packages, even when the list names `.`.
