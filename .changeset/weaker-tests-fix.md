---
'@santi020k/pawl': patch
---

The fix of a `pawl/no-weaker-tests` finding matches what the test file lost or gained. Every finding of the rule said "Put back the assertions with the values they pinned, or make the skipped test pass", also for a new retry, a raised timeout or a fixed sleep. A finding now names which of the three it found, and its fix, in `--format agent`, `github` and `sarif` and in the terminal, is the one for that: fix why the test fails now and then for a retry, wait for what the test waits for for a raised timeout, and wait with an assertion that retries for a fixed sleep. The rule's summary also names retries, raised timeouts and fixed sleeps.
