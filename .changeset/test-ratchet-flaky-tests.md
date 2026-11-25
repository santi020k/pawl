---
'@santi020k/pawl': minor
---

The test ratchet also counts what can make a flaky test pass now and then instead of fixing it, so a test cannot be kept green with a retry or a longer wait:

- a retry: `retry: 2`, `retries: 2`, `test.retry(2)`, `jest.retryTimes(2)`, `this.retries(2)`;
- a raised timeout: a `timeout` option, `jest.setTimeout`, `test.setTimeout`, `test.slow()`, or a number after the test's function;
- a fixed sleep: `waitForTimeout`, `cy.wait(500)`, `setTimeout(resolve, 500)`, `sleep(500)`.

A test file with more of those lines than the baseline recorded fails as `pawl/no-weaker-tests`. A `timeout` on an assertion that retries, such as `expect(...).toBeVisible({ timeout })` or `waitFor(..., { timeout })`, is how to wait well and does not count. A baseline from an earlier version has no count for these yet: once `pawl check` passes, run `pawl baseline` and commit `.pawl/baseline.json` to start counting. In the API, `TestCounts` has an optional `masks`.
