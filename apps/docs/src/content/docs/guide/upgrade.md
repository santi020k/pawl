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

3. Run `pawl sync`. It rewrites the files pawl writes from the policy where the new release writes them differently: the root `biome.json`, the rules in `.pawl/rules/`, `.oxlintrc.json` and the Prettier config. ESLint reads the policy live, so it has nothing to sync. Until these files match, `pawl check` in CI exits with code 2.

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

## Workspace Biome configs before 0.4

Biome 2.6.8 interprets inherited file patterns relative to a nested config. Earlier Pawl setup generated nested configs, which could change root policy ignores and overrides. New setup writes package domains and rules as root-scoped overrides instead.

If a workspace already has `biome.json` or `biome.jsonc`, Pawl refuses to run Biome until it is explicitly migrated. `sync`, `check` and `fix` preserve those files; they do not delete, rename or overwrite them. Review the nested configuration and its inherited settings. Preserve an original backup with a name other than `biome.json` or `biome.jsonc`, without replacing an existing backup. Move package rules into root policy overrides with root-relative file patterns, preserve custom parser and formatter settings in the root configuration, and remove the active nested config only after that review. Run `pawl sync`, `pawl doctor`, `pawl check` and the framework's own validation. Commit the reviewed migration and backup together.

A customized child configuration may need additional manual work. Do not widen policy globs or create a baseline to hide changed scope. Until the migration is verified, keep the existing release in production.

Pawl's own docs migration preserves the former file as `apps/docs/biome.before-root-scopes.json`. Biome 2.6.8 accepts `html.experimentalFullSupportEnabled` inside overrides but does not apply it there. The docs' original HTML support is therefore explicitly enabled at the top level of this repository's root config. All 12 existing HTML-family source files are Astro files in `apps/docs`; this preserves their parser behavior. This is a repository-specific choice, not a Pawl default or an automatic consumer migration. Other repositories must review their own parser boundaries. Roll back by restoring the preserved config and the prior Pawl version together; do not combine the old nested config with the new scope contract.

## Existing inline root overrides

Pawl cannot distinguish custom entries from older generated entries in an existing root `overrides` array. When the expected array changes, `sync` preserves the file and reports the conflict; `check` and `fix` stop with exit code 2 before running Biome. This also protects templates when a new package adds technology scopes.

Keep a backup outside Biome's active config filenames before reconciling. Move rule exceptions into root-relative `pawl.config` overrides, retaining their order and rule options. Keep custom parser or formatter overrides in a separate JSON configuration extended after the Pawl preset, and verify their precedence against the generated package scopes. Do not discard any entry until its replacement is accounted for. Only then remove the reconciled inline array, run `pawl sync`, and review the generated diff. Run `pawl doctor`, `pawl check`, and framework validation before committing the configuration and backup. Restore the backup and prior Pawl version together if qualification fails.

## Agent hooks before 0.5

Before 0.5, `init --agents` wrote `npx pawl check --changed --format agent` for Claude Code and `npx pawl fix --changed` for Cursor. Claude Code does not show the model a hook's plain output, so Claude never saw those findings, and a plain `npx pawl` can download the unscoped `pawl` package, which is someone else's, in a clone that has not installed pawl yet. Run `pawl init --agents` again: it swaps those commands for `npx --no pawl fix --hook` in place, adds the stop hook and the pawl skill, and leaves your other hooks alone. `pawl init --hooks` and `pawl init` do the same for a pre-commit line and the editor tasks pawl wrote. See [Coding agents](/guide/agents/).

A baseline recorded before 0.5 has no test counts, so `pawl/no-weaker-tests` has nothing to compare against yet; `pawl check` says so. Once `pawl check` passes, run `pawl baseline` to start counting, and commit `.pawl/baseline.json`.
