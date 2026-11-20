---
'@santi020k/pawl': patch
---

A `style.lineWidth` over 320 is refused when the policy loads, with a message that says the range. Biome refuses a config with a wider line, and pawl writes one for every project, so such a policy used to stop every check with Biome's own error.
