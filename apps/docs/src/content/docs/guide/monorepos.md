---

title: Monorepos
description: "One pawl run from the root covers pnpm, npm and yarn workspaces, Turborepo and Nx. Each package gets only the rules for the technologies it uses."
head: [{ tag: title, content: "Monorepos: workspaces, Turborepo and Nx | pawl" }]
---

Pawl detects pnpm, npm, yarn and Bun workspaces, Turborepo and Nx. It runs once from the root and covers every package.

The packages come from the `packages` list of `pnpm-workspace.yaml` and from `workspaces` in the root `package.json`. A pattern may name a folder, use `*` for one level (`packages/*`, `plugins/plugin-*`) or `**` for any depth, and take packages out again with a leading `!`. `pawl doctor` shows how many packages it found on the `Project` line.

## Rules follow the technology

When one package uses a technology the rest of the repo does not, `init` gives that package its own small `biome.json`:

```json title="apps/web/biome.json"
{ "root": false, "extends": ["../../biome.json", "@santi020k/pawl/biome/react"] }
```

So React rules apply in the React app and nowhere else. The same goes for Qwik, Vue, Svelte and Turborepo, which ship as separate presets.

`pawl check` reports a package that starts using a new technology until `pawl sync` has been run.

## Turborepo

In a Turborepo, `init` also adds `check` and `fix` to `turbo.json` as root tasks, uncached, so `turbo run check` runs pawl with the rest. Pawl checks the whole repo in one run, and a cached result would hide new findings.

## Nx

Under Nx, `init` makes the root a project with `check` and `fix` as uncached targets, so `nx run-many -t check` runs pawl with the rest.

## A shared standard across repos

For a standard shared by many repos rather than many packages, publish a [shared policy](/guide/policy/#a-shared-policy) and extend it from each one.
