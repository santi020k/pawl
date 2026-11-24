---
'@santi020k/pawl': minor
---

Version JSON check reports with an additive `reportVersion: 1` field and export `readCheckReport` for consumers that validate captured output against the actual process exit code. The reader rejects malformed reports, unsupported versions, contradictory baseline metadata and false success after setup failures. Existing result fields stay at the top level.
