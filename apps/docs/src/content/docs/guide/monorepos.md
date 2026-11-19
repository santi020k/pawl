---

title: Monorepos
description: One run from the root covers every package, and each package gets only the rules for what it uses.
---

Pawl detects pnpm, npm and yarn workspaces, Turborepo and Nx. It runs once from the root and covers every package.

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
