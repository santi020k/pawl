# Roadmap for 0.6.0

The work planned on `release/v0.6.0`. The branch starts from `release/v0.5.0` as it was merged for the 0.5.0 release. Tick an item when it lands on the release branch; move an item to "Deferred" when it leaves this release.

## Branch setup

- [ ] After the 0.5.0 pull request merges and its Release run is green, merge `main` into `release/v0.6.0` and push it: `git push -u origin release/v0.6.0`.
- [ ] Every feature on this branch adds a changeset. At least one must be a minor, so that Changesets arrives at 0.6.0.
- [ ] Feature branches are named `0.6.0/<topic>` and merge into `release/v0.6.0` after `pnpm ok` passes on them.

## Landed

- [x] Findings in CI where people read them (`0.6.0/ci-annotations`): `--format github` puts each new finding on its line in the pull request as a GitHub Actions annotation, and `--format sarif` prints SARIF 2.1.0 for GitHub code scanning. The workflow `init --workflow` writes uses `--format github`.

## Candidates

None is committed to this release until someone starts it. Sizes are relative: S is a contained change in one layer, M touches several layers.

- [ ] Guard the baseline from coding agents (S). A pre-tool hook that asks before an agent edits `.pawl/baseline.json`, the policy or the engine configs, or runs `pawl baseline`, and `check --ci --since <base>` failing when the baseline gained entries against the base branch. Open question: how a person marks a baseline change as intended, for example after an upgrade adds findings: a pull request label, a commit trailer, or a CODEOWNERS entry for `.pawl/` that `init` writes.
- [ ] Approved and retired AI models in the policy (M). `ai: { models: [...] }`, lockable by a shared policy, and a catalog of retired model IDs per provider; a guard flags a model string in an AI SDK call that is retired or not on the list.
- [ ] `pawl upgrade` (S to M): install the tool versions `doctor` expects, run `sync`, and say what changed.
- [ ] More git hook managers (S to M): a lint-staged entry, an edit to lefthook's YAML that keeps comments, and a local hook for `.pre-commit-config.yaml`.
- [ ] More coding agents (S each): Windsurf and Devin (the Claude Code hook format), Aider (`read: [AGENTS.md]` and `lint-cmd`), each with the stop hook where the agent has a stop event.
- [ ] The rest of the test ratchet: retries and raised timeouts that hide a flaky test, and fixed sleeps in tests.
- [ ] `pawl fix --baseline` with a coding agent: fix findings the baseline still allows, check again and shrink the baseline.
- [ ] Oxfmt as a formatter (M to L), with the policy's style written into its config.
- [ ] `pawl lsp` (M to L): new findings as errors and baselined ones as hints in every editor, from one long-running process.
- [ ] Decide whether `pawl check` picks `--format github` on its own under GitHub Actions, as it picks `agent` for coding agents.

## Closing the release

- [ ] Run `pnpm version-packages`, commit, then `pnpm release:check`.
- [ ] Open the pull request with `gh pr create --template release.md`.
- [ ] After the Release run is green, check npm and GitHub, then delete the branch and this file.
