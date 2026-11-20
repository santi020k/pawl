---
"@santi020k/pawl": patch
---

A pnpm workspace whose `packages` list has no indent, or is written on one line as `[apps/*, packages/*]`, is read as a monorepo. Pawl saw a single package there, so it missed the technologies of the packages and gave none of them a Biome config of its own. Workspace patterns with a wildcard inside a name, such as `plugins/plugin-*`, with `**`, and with a leading `!` are followed as well.
