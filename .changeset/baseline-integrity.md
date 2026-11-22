---
"@santi020k/pawl": patch
---

`pawl baseline` leaves the baseline as it was when part of the check did not run, and `pawl init` no longer leaves a half-recorded one behind. A baseline written without the findings of an engine that failed made those findings fail later as new. A baseline that cannot be read, such as one with a merge conflict in it, now stops the check with exit code 2 and the new `baseline-unreadable` setup problem, where it used to report every old finding as new. `pawl doctor` lists it as a problem.
