---
'@santi020k/pawl': patch
---

An `eslint-disable` or `eslint-enable` comment that switches off nothing is reported as `eslint:unused-disable-directive`. It was reported as `eslint:parse`, as if ESLint could not read the file, and `pawl explain` said to fix a syntax error. `pawl fix` removes the comment. A baseline that recorded one as `eslint:parse` no longer covers it: run `pawl fix`.
