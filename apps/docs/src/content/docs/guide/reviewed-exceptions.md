---

title: Reviewed exceptions
description: Preserve necessary ordering and accessible CSS behavior with narrow, tested policy exceptions.
---

## Operations that must remain serial

`no-await-in-loop` is advice about independent work. Browser interactions, writes
to an ordered output stream, provider polling and pagination whose next cursor
comes from the previous response must remain serial. Converting these operations
to `Promise.all` can change behavior or corrupt output.

Keep the ordering, document why the operation depends on the previous result, and
scope an exception to the responsible file in the policy. Test the call order,
failure handling and cancellation before accepting the exception. A locked rule
requires a decision in its owning shared policy; local exceptions cannot lower it.

```ts
export default {
  overrides: [
    {
      files: ['/scripts/poll-deployment.ts'],
      rules: { 'no-await-in-loop': 'off' }
    }
  ]
}
```

## Accessible CSS and generated themes

Check cascade layers and specificity before adding `!important`. Some reduced-motion
styles and overrides of generated theme declarations need it to win the cascade.
Do not remove those declarations just to clear a finding. Capture the relevant
rendered state and test reduced-motion behavior or computed styles first.

Use the exact stylesheet scope for a reviewed
`biome:complexity/noImportantStyles` exception. Keep the reason beside the policy
entry, and keep other stylesheets checked. Pawl does not automatically remove
these safeguards or add suppression comments, which are subject to its ratchet.
