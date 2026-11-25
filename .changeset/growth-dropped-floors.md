---
'@santi020k/pawl': patch
---

`pawl/no-baseline-growth` fails a branch whose baseline no longer counts the tests at all, or no longer counts the retries, raised timeouts and fixed sleeps of a test file. Both take a floor away, as a test file that is no longer counted does, and passed `check --since` without a word.
