---

title: Getting started
description: Set up pawl in a repo and run the first check.
---

:::caution
Pawl is in early development and is not published to npm yet.
:::

## Set up a repo

```sh
npx @santi020k/pawl init
```

`init` looks at the repo, shows what it will change, and asks before writing. It writes a small `biome.json`, adds `check` and `fix` scripts, sets up the editor, and records the findings the repo already has in `.pawl/baseline.json`.

## Daily use

```sh
pawl check   # lint, check formatting, apply the ratchet
pawl fix     # apply safe fixes and format
```

The engines also work on their own. `npx biome check` uses the same config.

## Requirements

Node 22.18 or later.
