# Pawl v1: the next step for my linting tools

Editorial status: draft for santi020k.com, to publish only after the v1 release is verified. Suggested description: "Why I built Pawl: one linting policy, your choice of engines, and guardrails for code written by people and agents." Use the site's current article schema, actual publication date and approved cover asset when importing this draft. The body begins below.

---

Pawl v1 is here: the next generation of my linting tools, built around a shared standard and the engines you choose.

With ESLint Config Basic, the focus was a reusable ESLint configuration. Pawl takes that idea further. It brings policy, setup, migration, checks and a baseline into one CLI, while keeping the underlying tools visible.

You can lint with Biome, Oxlint or ESLint, and format with Biome or Prettier. Optional packs cover checks that need ESLint plugins. Pawl does not make every engine equivalent: coverage depends on your setup, and its doctor command helps you see what is missing.

## A standard that can move forward

The name comes from the part of a ratchet that stops it slipping backward. In a codebase, that means recording reviewed existing findings in a baseline and blocking new findings according to your policy. You can improve an established project without pretending its existing problems have disappeared.

The same idea matters when working with coding agents. A compact report gives an agent findings it can act on:

```sh
pnpm exec pawl check --changed --format agent
```

This example assumes Pawl is already installed in a pnpm project. Use your own project's package manager and scripts. A changed-files check covers uncommitted changes and untracked files; it is not a substitute for the full validation your project requires.

The optional Codex and Claude Code plugin adds a shared workflow for setup previews, scoped checks, fixes and diagnosis. It uses the CLI and does not add automatic hooks when installed.

## Coming from ESLint Config Basic

I recommend evaluating Pawl for new projects and planned migrations from ESLint Config Basic. Start with the migration guide, preview the changes, and review engine coverage, rule options and file-specific behavior before switching. Keeping ESLint as the engine is an option.

This is an invitation to adopt a more complete workflow, not a claim that every project can migrate without review.

Explore [Pawl's documentation](https://pawl.santi020k.com), read the [migration guide](https://pawl.santi020k.com/guide/migrate/), and check the [release notes](https://pawl.santi020k.com/changelog/). The project is [on GitHub](https://github.com/santi020k/pawl).

Built by [Santiago Molina](https://santi020k.com).

---

Publication note: add verified Claude and Codex listing links and the ESLint Config Basic announcement link before launch. If a store approval is pending, state that explicitly instead of saying both plugins are available.
