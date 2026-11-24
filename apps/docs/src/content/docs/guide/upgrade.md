---

title: Upgrading
description: Move a repo to a new pawl release, match the tool versions it expects, sync the config and handle new findings.
---

Read the release's notes in the [changelog](/changelog/) first. Until 1.0, a minor release may change the API or the standard.

## Upgrade a repo

1. Install the new version. A repo that extends `@santi020k/pawl-policy` upgrades it in the same command, because the two packages share one version.

   ```sh
   npm install -D @santi020k/pawl@latest
   npm install -D @santi020k/pawl@latest @santi020k/pawl-policy@latest   # with the policy
   ```

   With pnpm it is `pnpm add -D`, with yarn `yarn add -D` and with Bun `bun add -d`.

2. Run `pawl doctor`. A release can move the Biome version pawl pins, or the range it takes for ESLint, Oxlint, Prettier or a pack's plugin. The doctor names each tool that does not match and the version to install:

   ```txt wrap
   Problem: @biomejs/biome 2.5.0 is not a version pawl works with (2.6.8). Install @biomejs/biome@2.6.8.
   ```

   Install Biome at that exact version:

   ```sh
   npm install -D --save-exact @biomejs/biome@2.6.8
   ```

3. Run `pawl sync`. It rewrites the files pawl writes from the policy where the new release writes them differently: `biome.json` and the Biome configs of each package, the rules in `.pawl/rules/`, `.oxlintrc.json` and the Prettier config. ESLint reads the policy live, so it has nothing to sync. Until these files match, `pawl check` in CI exits with code 2.

4. Run `pawl check`. A release that adds a rule, or makes one stricter, can report findings the baseline does not cover, and they fail like any new finding. Fix them, or run `pawl baseline` to accept them; the change to `.pawl/baseline.json` shows in review.

5. Commit `package.json`, the lockfile, the files `sync` rewrote and the baseline together.

## Keep Biome exact

Pawl works with one exact Biome version, because it reads a report format Biome may change between releases. Keep that version exact in `package.json`, `2.6.8` rather than `^2.6.8`, so that installing without the lockfile cannot pick a Biome the installed pawl does not take. `npm install --save-exact`, `pnpm add --save-exact`, `yarn add --exact` and `bun add --exact` all write it that way.

## Which version a repo runs

```sh
npx --no pawl --version
```

`pawl doctor` prints the version on its first line too, and `pawl doctor --format json` puts it in the report CI keeps.

## A policy package of your own

A company policy package, such as `@acme/pawl-policy`, extends pawl's standard, so a pawl upgrade reaches every repo that uses it. Upgrade pawl in the policy package's own repo first, run its tests, then publish a version of the policy that repos move to with step 1. See [The policy](/guide/policy/#a-shared-policy).
