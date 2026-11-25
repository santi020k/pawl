---
'@santi020k/pawl': patch
---

The baseline never accepts a parse error. `pawl init` and `pawl baseline` recorded `eslint:parse`, `biome:parse` and the other engines' parse errors like any finding, so a file with a syntax error passed every check after that, and the engine never checked it again. Now they record the other findings, name each file that did not parse with its first error, and leave the parse errors to fail the check until the file parses; `pawl baseline` then exits with 1. A parse error that a baseline from an earlier pawl counts fails too. In the API, `createBaseline` leaves parse errors out, `applyBaseline` never allows one, and `check` with `updateBaseline` returns them in `findings`.
