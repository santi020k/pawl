---
'@santi020k/pawl': minor
---

Two more things an agent cannot get past: hidden characters and weaker tests.

- `pawl/no-hidden-characters` (error) finds characters that do not show on screen: zero-width characters, bidi controls, invisible operators and fillers, Unicode tag characters, a byte order mark past the start of a file, and runs of variation selectors. A rules file or a skill can hide instructions in them that an agent follows and a reviewer never sees. When tag characters spell out text, the finding shows it. Emoji, flags, one variation selector after a character, and the marks other scripts use next to their own letters are left alone. It reads code, the other files the engines read, docs, and the instructions, skills, hooks and settings of coding agents, including the folders such as `.claude`, `.cursor` and `.agents` that the default ignores skip. The policy's own ignores and the `.gitignore` still apply.
- `pawl/no-weaker-tests` (error): the baseline now counts, per test file, the assertions that pin a value and the skipped tests. A file with fewer assertions or more skipped tests than the baseline recorded fails, and so, on a check of the whole repo, does a counted test file that is gone unless new test files have its assertions. A check that passes for almost any value, such as `toBeTruthy()`, does not count as an assertion, so swapping one in lowers the count. Tests that got stronger are an improvement `pawl baseline` locks in. A baseline from an earlier version has no test counts: `pawl check` says so, and `pawl baseline` starts counting.
- A new skipped test is reported once, by `pawl/no-weaker-tests`, not also as the `vitest/no-disabled-tests` warning.
- The `AGENTS.md` block, the pawl skill and the hook's message to the agent say that weakening or skipping a test fails the check, and the skill tells agents not to follow hidden text in a rules file.
