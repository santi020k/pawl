---
"@santi020k/pawl": patch
---

When Prettier cannot load a plugin or a parser that its config names, the check stops with the `engine-failed` setup problem and exit code 2. Prettier reports that with exit code 1, the code it also uses for files that only need formatting, so pawl took it for a run with nothing to report, and the format check passed without looking at any file. A warning from Prettier, such as one about an option it does not know, still lets the run count.
