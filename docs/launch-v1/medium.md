<!-- Editorial only — not part of the article.
Status: DRAFT for the v1 launch. Do not publish until the v1 release, npm installation,
documentation links, and described capabilities have been verified.
The body intentionally makes no claim that a public plugin store listing is live.
Add a store installation CTA only after its listing and installation have been verified.
Keep this note out of Medium. No publication date is assigned.
-->

# Pawl v1: keeping code quality moving forward

_From a shared ESLint configuration to a standard that works with the tools you choose._

I built Pawl around a practical question: how do you adopt a code standard in an existing repository, then keep new work from undoing the progress?

That question matters when people write the code, and when coding agents help write it. A useful check needs to explain what went wrong, fit the tools already in the project, and make the difference between accepted debt and a new regression visible.

Pawl brings those pieces together: a shared policy, linting and formatting through existing engines, and a baseline that lets a team improve incrementally.

## From an ESLint config to a shared policy

My `@santi020k/eslint-config-basic` packages provide a shared configuration for ESLint. Pawl carries rules and levels from that work into a separate policy layer, with optional packs for checks that need ESLint plugins.

You can choose Biome, Oxlint, or ESLint for linting, and Biome or Prettier for formatting. Biome is the default during automatic setup. The engines remain visible: you can still use their commands, and findings retain their engine rule names.

Choosing an engine involves tradeoffs. They do not enforce every rule identically, and some checks need an additional plugin. `pawl doctor` helps identify coverage and setup problems. I want those differences to be visible when someone decides which tools belong in their project.

## A baseline you can review

A pawl is the part of a ratchet that stops it slipping backward. In the project, `.pawl/baseline.json` records existing findings as counts per file and rule.

That makes adoption possible without fixing every old finding first. If a file already has one error for a rule, the baseline can allow that count. A second error exceeds the allowance and fails the check. Warnings follow the configured warning limit.

When you fix the original finding, you can deliberately record the lower count and commit the baseline change. That improvement becomes the new allowance. Updating the baseline is a reviewable decision: it can also accept more findings, so it should never be an automatic response to a failing check.

Pawl also checks for new disable comments. Silencing a rule should not be the easiest way to finish an agent's task.

## Feedback that agents can use

For a project with Pawl installed, the CLI supports:

```sh
pawl check --changed --format agent
```

Run it through your project's package manager. It reports findings as compact JSON lines, with fix guidance where available. `--changed` includes uncommitted and untracked files; in a shared checkout, explicit paths are better when unrelated work is present.

The optional Codex and Claude Code plugin adds a shared skill for setup, scoped checks, fixes, and diagnosis. It uses the installed CLI and adds no automatic hooks. The [agent guide](https://pawl.santi020k.com/guide/agents/) explains the available integrations and installation boundaries.

## Start with a migration preview

For an existing ESLint project, start with the [migration guide](https://pawl.santi020k.com/guide/migrate/) and `pawl migrate --dry-run`. Review the rule differences, file scopes, and engine coverage before applying changes. Unsupported configurations can require manual attention, and ESLint options are not automatically translated into Biome options.

My aim with Pawl is a standard a team can understand, adopt, and tighten over time. Explore the [documentation](https://pawl.santi020k.com), read how the [ratchet works](https://pawl.santi020k.com/guide/ratchet/), or inspect the [source on GitHub](https://github.com/santi020k/pawl).
