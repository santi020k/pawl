---
'@santi020k/pawl': patch
---

A syntax error in a YAML or GraphQL file, or in some Vue files, no longer stops the ESLint part of the check with "Could not read ESLint's report". Those parsers count columns from 0, and pawl refused a report with a column of 0, so the check dropped every ESLint finding of the run and reported a setup problem instead. The syntax error is now a finding on its line, `eslint:parse`, beside the others.
