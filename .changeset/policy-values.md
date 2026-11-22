---
"@santi020k/pawl": minor
---

Pawl checks the values of a policy, in every layer, as it already checked the names of its options. A level that is not `off`, `warn` or `error`, a string where a list belongs, an override without `files`, an unknown runtime or a pack name pawl does not have now stops the run with exit code 2, and the message names the place and what it takes: `"rules.no-console" is "warning". It must be "off", "warn" or "error".` Until now such a value passed in silence or failed later inside an engine. A policy that relied on a wrong value being ignored has to be corrected.
