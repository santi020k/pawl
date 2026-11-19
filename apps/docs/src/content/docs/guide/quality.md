---

title: With Quality
description: Run pawl as part of Quality, the one command for every check in a repo.
---

[Quality](https://quality.santi020k.com) runs the code-quality tools of a whole repo with one command: Rust, Swift, Kotlin and Python analyzers, Astro Check, CSpell, Knip, Actionlint and more, configured in `quality.yml`. Pawl owns the JavaScript and TypeScript side: Biome, Oxlint, ESLint, Prettier and the baseline. Use them together and each does its own part.

:::note
The integration is in beta. Quality plans a dedicated `pawl` adapter once pawl's JSON report is stable. Until then, run pawl as a Quality task, as shown below.
:::

## Quality leaves the engines to pawl

Pawl runs the engines itself and compares the result with `.pawl/baseline.json`. If Quality ran them too, it would check the same files twice and fail on findings the baseline allows. So Quality treats a repo as managed by pawl when any of these is true:

- a `package.json` depends on `@santi020k/pawl`
- a package script runs `pawl`
- a `pawl.config.{ts,mts,js,mjs,json}` file exists

In that repo Quality stops detecting Biome, Oxlint, ESLint and Prettier, even when their config files are present. In a monorepo this applies to every workspace. An adapter you turn on in `quality.yml` still runs.

## Run pawl as a task

```yaml title="quality.yml"
version: 1
tasks:
  pawl:
    name: Pawl
    command: pnpm
    args: [exec, pawl, check]
    extensions: [js, jsx, ts, tsx, mjs, cjs, mts, cts, json, css, astro, vue, svelte]
    config_files: [package.json, biome.json, .oxlintrc.json, pawl.config.ts, .pawl/baseline.json]
    required: true
```

`quality check` now runs pawl next to everything else, and pawl's exit codes keep their meaning: 1 for new findings, 2 for a setup problem.

## Which one to reach for

| You want to                                                      | Use                                               |
| ---------------------------------------------------------------- | ------------------------------------------------- |
| One lint and format standard, with a ratchet, for JS and TS code | Pawl                                              |
| One command and one CI job for every tool in the repo            | [Quality](https://quality.santi020k.com)          |
| Both                                                             | Pawl for the engines, Quality around it, as above |

Quality's side of this is in its [Pawl integration](https://quality.santi020k.com/adapters/#pawl-integration-beta) docs.
