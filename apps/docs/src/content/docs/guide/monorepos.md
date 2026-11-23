---

title: Monorepos
description: "One pawl run from the root covers pnpm, npm and yarn workspaces, Turborepo and Nx. Each package gets only the rules for the technologies it uses."
head: [{ tag: title, content: "Monorepos: workspaces, Turborepo and Nx | pawl" }]
---

Pawl detects pnpm, npm, yarn and Bun workspaces, Turborepo and Nx. It runs once from the root and covers every package, whatever each one is built with.

The packages come from the `packages` list of `pnpm-workspace.yaml` and from `workspaces` in the root `package.json`. A pattern may name a folder, use `*` for one level (`packages/*`, `plugins/plugin-*`), `**` for any depth, braces (`{apps,tools}/*`) and classes (`[ab]*`), and take packages out again with a leading `!`. Pawl reads them as pnpm does: `**` skips `node_modules`, `bower_components` and dot folders, and a `!` pattern is matched against the package's `package.json`, so `!**/test/**` takes out `packages/test` too. A `**` looks through 20,000 folders at most. `pawl doctor` shows how many packages it found on the `Project` line.

## Rules follow the technology

A monorepo often mixes stacks: a React app, a Vue admin, a Node API. A rule for a technology runs only in the packages that use it, whichever linter you pick. What the root `package.json` depends on counts for the whole repo.

**Biome.** When one package uses a technology the rest of the repo does not, `init` gives that package its own small `biome.json`:

```json title="apps/web/biome.json"
{ "root": false, "extends": ["../../biome.json", "@santi020k/pawl/biome/react"] }
```

**Oxlint.** `.oxlintrc.json` has one override for each such package, with the rules for its technologies and the plugins they need. A plugin switched on at the top would run its own default rules in every package, so it is switched on for that package only:

```json title=".oxlintrc.json"
{
  "plugins": ["import", "promise", "typescript", "unicorn"],
  "overrides": [
    { "files": ["apps/web/**"], "plugins": ["jsx-a11y", "react"], "rules": { "react/jsx-key": "error" } },
    { "files": ["apps/admin/**"], "rules": { "vue/require-prop-types": "error" } }
  ]
}
```

**ESLint.** The flat config holds a block for each such package with the rules for its technologies. A pack that only some packages depend on, such as `react-hooks`, runs in those packages only. A pack the policy names, a pack the root depends on, and a pack for a file type of its own, such as `vue` for `.vue` files, run repo-wide.

So React rules apply in the React app and nowhere else. The same goes for Next.js, React Native, Qwik, Solid, Vue, Svelte, Astro, Tailwind CSS, TanStack Query, Drizzle, Playwright and Turborepo. `pawl check` reports a package that starts using a new technology until `pawl sync` has been run. The policy's own [`overrides`](/reference/config/#overrides) come after the packages', so they win.

## Other languages in the repo

A monorepo can hold more than JavaScript: a Cargo workspace, an iOS app, an Android app. Pawl finds them, keeps Biome, Oxlint and ESLint out of the files their tools write, such as Cargo's `target` folder and Xcode's asset catalogs, and can check them with Clippy, rustfmt, SwiftLint, SwiftFormat and ktlint under the same baseline. See [Rust, Swift and Kotlin](/guide/languages/).

## Turborepo

In a Turborepo, `init` also adds `check` and `fix` to `turbo.json` as root tasks, uncached, so `turbo run check` runs pawl with the rest. Pawl checks the whole repo in one run, and a cached result would hide new findings.

## Nx

Under Nx, `init` makes the root a project with `check` and `fix` as uncached targets, so `nx run-many -t check` runs pawl with the rest.

## A shared standard across repos

For a standard shared by many repos rather than many packages, publish a [shared policy](/guide/policy/#a-shared-policy) and extend it from each one.
