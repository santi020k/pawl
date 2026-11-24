# Pawl v1 launch kit

Status: prepared drafts, not published. Owner: Santiago Molina. Target: the Pawl v1.0.0 launch; no publication date is set.

## Deliverables

| Deliverable                                | Prepared source                                                 | Release evidence to record                                  |
| ------------------------------------------ | --------------------------------------------------------------- | ----------------------------------------------------------- |
| Claude and Codex store listings            | [Plugin launch plan](../../CONTRIBUTING.md#plugin-stores-at-v1) | Both public listing URLs and successful installation checks |
| ESLint Config Basic recommendation release | [Announcement copy](eslint-config-basic.md)                     | Release version, release URL and updated migration link     |
| Website launch article                     | [Website draft](website.md)                                     | Public URL on santi020k.com                                 |
| Medium launch article                      | [Medium draft](medium.md)                                       | Public Medium URL                                           |

## Publication order

1. Complete the Pawl v1 release process and verify the npm package, documentation and release notes. Check every draft against the final v1 behavior; these drafts were prepared during v0.5 development.
2. Complete the Claude and Codex store submissions and verify public installation as described in the plugin launch plan. Track pending approval separately from publication. Add store links to the articles only after verification; do not claim availability while review is pending.
3. Prepare and release the ESLint Config Basic recommendation update in its own repository, through its normal release workflow. Choose its version there; do not assume that it also becomes v1. Verify that the recommendation is visible in the published package documentation and release notes.
4. Add the website draft to santi020k.com's existing article format. Use the site's current metadata, language and asset conventions, choose the actual slug and date, and validate the article in the website before deploying through its normal workflow.
5. Publish the Medium draft from Santiago's account after the website article is live. Link the website article as the author's original launch announcement. If publishing the same article verbatim instead of the distinct draft, configure the original website article as its canonical source using Medium's current publishing options.
6. Record all public URLs and verification results in the v1 release pull request. Check links, code formatting, mobile readability, authorship and the final calls to action on both published posts.

## Final editorial checks

- Confirm the title, v1 release status, supported engines, CLI commands and migration limitations against the shipped version.
- Replace editorial notes with verified links and dates. Remove all draft labels before publication.
- Use Pawl's existing brand assets. Prepare the article cover through the website's normal image workflow and verify its crop and alternative text; do not invent a second brand.
- Describe Pawl as Santiago's next-generation linting tool. Do not claim it is objectively the best or fastest without comparative evidence.
- Keep engine distinctions clear: Pawl coordinates policy and checks using Biome, Oxlint and ESLint; it does not replace their implementations or guarantee identical rule coverage.
- Do not announce ESLint Config Basic as deprecated, remove functionality, or automatically migrate users as part of this recommendation.

The drafts are maintained here until the v1 publication work. They have not been added to Medium, deployed on the website, or submitted to either plugin store.
