# Roadmap for 0.6.0

The work planned on `release/v0.6.0`. The branch starts from `release/v0.5.0` as it was merged for the 0.5.0 release. Tick an item when it lands on the release branch; move an item to "Deferred" when it leaves this release.

## Branch setup

- [ ] After the 0.5.0 pull request merges and its Release run is green, merge `main` into `release/v0.6.0` and push it: `git push -u origin release/v0.6.0`.
- [ ] Every feature on this branch adds a changeset. At least one must be a minor, so that Changesets arrives at 0.6.0.
- [ ] Feature branches are named `0.6.0/<topic>` and merge into `release/v0.6.0` after `pnpm ok` passes on them.

## Landed

- [x] Findings in CI where people read them (`0.6.0/ci-annotations`): `--format github` puts each new finding on its line in the pull request as a GitHub Actions annotation, and `--format sarif` prints SARIF 2.1.0 for GitHub code scanning. The workflow `init --workflow` writes uses `--format github`.
- [x] `pawl check` picks `--format github` on its own in a GitHub Actions job (`0.6.0/github-format-default`), after a coding agent's `agent` and before `pretty`.
- [x] The flat presets of Vue, Svelte, YAML, JSONC, TOML, Storybook, Astro 3 and HTML work again (`fix/spread-pack-plugins`, based on `main` so it can ship as 0.5.1 first).
- [x] Floors that hold (`0.6.0/peer-ranges`): ESLint `>=9.35.0`, `typescript-eslint` `>=8.15.0`, four plugin floors raised and nine plugins that took any version given one, each run against its plugin.
- [x] Guard the baseline (`0.6.0/baseline-guard`): a hook before each tool for Claude Code and Codex (not Copilot, which refuses a tool when the hook fails before the install), and `pawl/no-baseline-growth` with `--since`. A person accepts growth with a `Pawl-Baseline: accept` commit trailer.
- [x] The rest of the test ratchet (`0.6.0/flaky-test-ratchet`): retries, raised timeouts and fixed sleeps in tests.
- [x] `pawl upgrade` (`0.6.0/upgrade-command`).
- [x] The public API as a generated report, `packages/pawl/api.md` (`0.6.0/api-snapshot`), and the plugin's skill generated from the same guidance as the one `init` writes (`0.6.0/skill-single-source`).
- [x] A weekly engine canary and a Windows job that does not block yet (`0.6.0/ci-canary-windows`).
- [x] Hardening on `release/v0.6.0`: the CI output against workflow-command injection and odd paths, the engine reports and exit codes, the baseline's shape, and the ESLint cache's file reads.
- [x] Docs: a benchmarks page from `scripts/bench.ts`, the adoption pages folded into three, the report contract under Reference, and a Pawl in use page (`0.6.0/benchmarks`, `0.6.0/docs-adoption-pages`, `0.6.0/docs-case-studies`).

## Deferred

These did not land in 0.6.0 and go to a later release. Sizes are relative: S is a contained change in one layer, M touches several layers.

- More git hook managers (S to M): a lint-staged entry, an edit to lefthook's YAML that keeps comments, and a local hook for `.pre-commit-config.yaml`.
- More coding agents (S each): Windsurf and Devin (the Claude Code hook format), Aider (`read: [AGENTS.md]` and `lint-cmd`), each with the stop hook and the guard where the agent has those events.
- `pawl fix --baseline` with a coding agent: fix findings the baseline still allows, check again and shrink the baseline.
- Approved and retired AI models in the policy (M): the catalog of retired model IDs needs updating every release; worth it once a policy package asks for it.
- Oxfmt as a formatter (M to L), with the policy's style written into its config.
- `pawl lsp` (M to L): new findings as errors and baselined ones as hints in every editor, from one long-running process.

## Closing the release

- [ ] Run `pnpm version-packages`, commit, then `pnpm release:check`.
- [ ] Open the pull request with `gh pr create --template release.md`.
- [ ] After the Release run is green, check npm and GitHub, then delete the branch and this file.
