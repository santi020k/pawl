---
"@santi020k/pawl": minor
---

`pawl migrate --extends <policy>` moves a repo onto a company policy: the new `pawl.config.ts` extends it, what your config has stricter than it is carried over, and a rule your config had looser stays at the policy's level and is listed in the report.

`migrate` also writes much less for a project that lints through a shared config. It finds the plugins that config brings, so their rules are compared instead of all carried over; it drops default ignores repeated for each workspace, such as `packages/a/**/dist`; and it reads the ignores of an `eslint.config.ts`.
