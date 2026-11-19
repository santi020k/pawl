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

Merging to `main` runs `.github/workflows/release.yml`. Changesets opens a version pull request; merging it publishes to npm with provenance through trusted publishing, creates the GitHub release and tags `v<version>`.

The first release, `0.1.0`, is published by hand once so the package exists on npm; then npm trusted publishing is configured for `release.yml` and every later release goes through the workflow.

## Secrets

Runtime secrets live in Infisical. `.infisical.json` is added once the pawl Infisical project exists; the manual `infisical-connection.yml` workflow then checks the OIDC connection with the `INFISICAL_IDENTITY_ID` and `INFISICAL_PROJECT_SLUG` repository variables. Never commit a secret or an `.env` file.
