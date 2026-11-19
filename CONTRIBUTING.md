# Contributing

Thank you for improving pawl. Read [AGENTS.md](AGENTS.md) first: it holds the rules of the codebase.

## Setup

Use Node.js 22.18 or newer and pnpm (the version in `packageManager`):

```sh
pnpm install
pnpm hooks:install   # commit-msg, pre-commit and pre-push hooks, run by Quality
pnpm ok              # the full gate CI runs
```

The hooks come from [`quality.yml`](quality.yml) and need the [Quality CLI](https://github.com/santi020k/quality).

## Commits

Commits follow Conventional Commits. `pnpm commit` opens [Commitprompt](https://github.com/santi020k/commitprompt), and the `commit-msg` hook validates every message.

## Changesets

Run `pnpm changeset` for any user-visible change to `@santi020k/pawl`. Choose patch, minor or major by semantic versioning and describe the effect for users. Changes that do not affect the package can use the `skip-changelog` label instead.

## Pull requests

Use a Conventional Commit title, keep changes focused and add tests for behavior changes. After changing a rule, the style or the Biome version, regenerate the presets and the rules page; `pnpm ok` fails if they are out of date.

## Releases

`@santi020k/pawl` and `@santi020k/pawl-policy` share one version. A release is a pull request from a `release/v<version>` branch into `main`; nothing else changes a version, and CI refuses a version change on any other branch.

1. Start from an up-to-date `main` and create the branch. Changesets decides the version: run `pnpm changeset status` to see it, then `git switch -c release/v<version>`.
2. Run `pnpm version-packages`. It consumes the changesets and writes the versions, the changelogs and the lockfile. It needs a `GITHUB_TOKEN` to link pull requests in the changelog. Commit the result.
3. Run `pnpm release:check`, then push the branch and open the pull request with `gh pr create --template release.md`. CI runs the same check: the branch name, every package version and the changelogs must agree, no changeset may be left, and the version must be new on npm and untagged.
4. Merge the pull request. `.github/workflows/release.yml` runs on `main`: it validates the repository, publishes the versions npm does not have with provenance through trusted publishing, installs them from the registry, then creates the `v<version>` tag and the GitHub release on the merged commit.
5. Check the release on npm and GitHub, then delete the release branch.

Work for the next version can start before the current one is out: create its `release/v<version>` branch early and open feature pull requests into it. CI checks those pull requests like the ones into `main`, and each still needs a changeset. Run `pnpm version-packages` on the branch only when the release is ready.

The workflow publishes only what is missing, so a failed run is fixed with "Re-run failed jobs" on that same run, which keeps the release commit. Do not merge anything else into `main` until the release run is green; the workflow refuses to release a later commit that carries new changesets. A published version or tag is never replaced: fix a bad release with a new version. To roll back, deprecate the version with `npm deprecate` and release a fix.

### First release and setup

npm trusted publishing needs the package to exist, so the first version of each package is published by hand, once, from the merged `main` commit, the library first: `pnpm ok`, then `pnpm --filter @santi020k/pawl publish --access public` and the same for `@santi020k/pawl-policy`. A version published by hand has no provenance. The Release run of that merge stops with a message that says so. Then:

1. On npm, add a trusted publisher to each package: repository `santi020k/pawl`, workflow `release.yml`, environment `npm`.
2. Choose "Re-run failed jobs" on that Release run. It finds the versions on npm, checks them and creates the tag and the GitHub release on the release commit.

The `npm` environment on GitHub should allow only the `main` branch. Protect `main` so that it takes pull requests only and requires the CI checks.

## Secrets

Runtime secrets live in Infisical. `.infisical.json` is added once the pawl Infisical project exists; the manual `infisical-connection.yml` workflow then checks the OIDC connection with the `INFISICAL_IDENTITY_ID` and `INFISICAL_PROJECT_SLUG` repository variables. Never commit a secret or an `.env` file.
