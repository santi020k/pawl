---
'@santi020k/pawl': patch
---

The test ratchet counts a `retry`, `retries` or `timeout` option only where it raises them for a test: on `test`, `it`, `describe`, their hooks, `test.describe.configure` or `vi.setConfig`. A timeout on an assertion that retries or on `waitFor` no longer counts when the formatter puts it on a line of its own, nor does an option of the code a test calls, such as `createClient({ timeout: 100 })`, or one written in a string, a template or a comment. A fixed sleep on the same line as a retrying assertion now counts.
