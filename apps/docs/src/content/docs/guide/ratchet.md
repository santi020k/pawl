---

title: The ratchet
description: How the baseline lets a repo adopt the standard without fixing everything first.
---

`.pawl/baseline.json` records how many findings of each rule each file had when the repo adopted the standard. Commit it.

- Findings within those counts are allowed.
- Anything beyond them fails the check.
- A file that gains a disable comment fails with `pawl/no-new-disable`.

When the code improves, `pawl check` says so. Run `pawl baseline` to lock the improvement in.

Counts are per file and rule, not per line, so moving code around does not break the baseline.
