---
"@santi020k/pawl": patch
---

Pawl starts every engine with colour switched off. Under a task runner that sets `FORCE_COLOR`, such as Turborepo, Prettier coloured its errors, so a file it could not parse was not recognised and the check stopped as a setup problem, and the message of every setup problem carried colour codes.
