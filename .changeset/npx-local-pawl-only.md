---
'@santi020k/pawl': patch
---

Every command pawl writes runs the project's own pawl, and never downloads the unscoped `pawl` package from npm.

- A plain `npx pawl` looks on npm for a package called `pawl` when the project has not installed `@santi020k/pawl`, as in a fresh clone before the install. That name belongs to someone else. In a hook, an agent's shell or CI, npm answers its own question with yes. The agent hooks, the pre-commit hook, the `AGENTS.md` block, the skill, the VS Code and Zed tasks and the GitHub workflow now run `npx --no pawl`, which runs the local copy or fails.
- Running `init --agents` again swaps the `npx pawl fix --hook` hooks that 0.3.0 wrote for `npx --no pawl fix --hook`. `init --hooks` swaps the `npx pawl check --changed` line pawl wrote in `.husky/pre-commit` or `.git/hooks/pre-commit`, and `init` the command of a `pawl: check` or `pawl: fix` task pawl wrote.
- The `AGENTS.md` block and the skill tell agents what to do when npx cannot find pawl: install the project's dependencies, and never the package called `pawl`.
- Without a `package.json`, `init` now says to run `npx @santi020k/pawl check`.
