---
"@santi020k/pawl": patch
---

`pawl check --since`, `--changed` and a list of files work for a pull request that touches thousands of files. Pawl gave an engine every file on one command line, which the system refuses past a limit, about 32,000 characters on Windows, and the check crashed with a spawn error. A long list now goes to each engine in several runs, one after the other, and `--verbose` shows the command once with the number of files and runs. An engine that cannot be started at all is reported as the `engine-failed` setup problem with exit code 2, not as a crash.
