---

title: Adopt without a baseline
description: Set up Pawl while keeping existing findings visible and shared policy rules enforced.
---

By default, `pawl init` records existing findings in a baseline. To adopt Pawl
without accepting those findings, use `--no-baseline`:

```sh
pawl init --yes --no-baseline --dry-run
pawl init --yes --no-baseline
pawl check
```

The dry run describes the configuration writes and confirms that no baseline
will be recorded. The second command installs the selected tools and writes the
configuration. It does not accept existing findings. Run `pawl check` to validate
the source: existing errors still fail, and warnings follow the policy's warning
limit. Setup success alone does not mean the source passes.

For a shared standard, create the policy before running init:

```ts
import { definePolicy } from '@santi020k/pawl'

export default definePolicy({ extends: '@santi020k/pawl-policy' })
```

Install the shared policy package in the project before using it. Init retains
that policy and its locked rule floors; `--no-baseline` does not loosen rules or
change ignores. Keep existing framework validation and semantic ESLint checks
that the selected engine does not replace.

The option also works with `pawl migrate --no-baseline`. Migration's normal
configuration-preservation checks still apply.

## Existing baselines

`--no-baseline` prevents recording a new baseline. It does not delete, rewrite
or bypass an existing `.pawl/baseline.json`. Init reports when that file already
exists, and subsequent checks still apply it. Review existing accepted findings
before deciding to remove a baseline; this option does not silently undo that
previous decision.

## Library use

Pass `baseline: false` to `planInit`. The returned plan carries that choice, and
`recordBaseline(root, plan)` returns without writing when it is disabled. The
planner itself never writes files.
