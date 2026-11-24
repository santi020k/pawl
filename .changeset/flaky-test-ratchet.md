---
'@santi020k/pawl': minor
---

The test ratchet also counts what can make a flaky test pass now and then instead of fixing it: a retry (`retry`, `retries`, `jest.retryTimes`, `this.retries`), a raised timeout (a `timeout` option, `jest.setTimeout`, `test.setTimeout`, `test.slow()`, a number after the test's function) and a fixed sleep (`waitForTimeout`, `cy.wait(500)`, `setTimeout(resolve, 500)`, `sleep(500)`). A test file with more of those lines than the baseline recorded fails as `pawl/no-weaker-tests`. A `timeout` on an assertion that retries, such as `expect(...).toBeVisible({ timeout })` or `waitFor(..., { timeout })`, is how to wait well and does not count. A baseline from an earlier version has no count yet: `pawl baseline` starts counting.
