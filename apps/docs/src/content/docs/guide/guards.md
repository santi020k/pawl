---

title: Guards and file checks
description: Checks that need no plugin, for the libraries a project uses and for its Docker and Markdown files.
---

## Guards

A guard is a set of checks for one library. It needs no plugin, and switches on when the project depends on the library.

| Guard                                          | On when the project uses                 | What it refuses                                                                                                                                                          |
| ---------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ai-keys`                                      | Any AI SDK below, but AutoGen            | An API key written in the code, and `dangerouslyAllowBrowser: true`                                                                                                      |
| `ai-sdk`                                       | `ai`, `@ai-sdk/*`                        | Imports of package internals                                                                                                                                             |
| `openai`, `anthropic`                          | `openai`, `@anthropic-ai/sdk`            | Imports of package internals                                                                                                                                             |
| `openai-agents`                                | `@openai/agents`                         | Internals, and agents from the base OpenAI client                                                                                                                        |
| `google-genai`                                 | `@google/genai`, `@google/generative-ai` | Internals, and the legacy SDK                                                                                                                                            |
| `langchain`, `llamaindex`, `mastra`, `autogen` | Those packages                           | Imports of package internals                                                                                                                                             |
| `mcp`                                          | `@modelcontextprotocol/sdk`              | Imports of internal modules                                                                                                                                              |
| `hono`                                         | `hono`                                   | Internals, and a hand-written wildcard CORS header                                                                                                                       |
| `zod`                                          | `zod`                                    | `.optional().nullable()`, `z.object().strict()` or `.passthrough()`, `.trim()` after a length check, a method after `.meta()`, `.describe()`, a union of string literals |
| `testing-library`                              | Any Testing Library package              | `await` on a synchronous `getBy` or `queryBy` query, and queries taken from `render()` instead of `screen`                                                               |
| `testing-library-find-by`                      | Any Testing Library package              | `waitFor()` around a `getBy` or `queryBy` query, where `findBy` waits by itself (warn)                                                                                   |
| `testing-library-debug`                        | Any Testing Library package              | `screen.debug()`, `prettyDOM()` and other debugging calls (warn)                                                                                                         |
| `testing-library-dom`                          | A framework's Testing Library package    | Imports of `@testing-library/dom` in place of the framework's one                                                                                                        |
| `nuxt`                                         | `nuxt`                                   | `process.client`, `process.server` and the other flags `import.meta` has                                                                                                 |

Import restrictions run in whichever linter you use. Code patterns run in Biome as rules pawl writes itself into `.pawl/rules/`, or in ESLint. With Oxlint as the only linter they do not run, and `pawl doctor` says so.

`de-morgan` is an opt-in guard: `pawl add de-morgan` flags `!(a && b)` and `!(a || b)` with no plugin.

A guard's findings carry the name `pawl/<guard>`. `pawl explain pawl/ai-keys` shows what that guard refuses, the level it runs at, and whether it is on in this project.

Your own restrictions merge with the guards:

```ts
export default definePolicy({
  options: {
    'no-restricted-imports': [{ paths: [{ name: 'lodash', message: 'Use lodash-es.' }] }]
  }
})
```

## Dockerfiles and Compose files

Pawl checks these itself. There are 17 checks: unpinned images, secrets in the file, images that run as root, privileged services, the Docker socket, and more. They run with `pawl check`, follow the baseline, and take a level in the policy:

```ts
export default definePolicy({
  rules: { 'pawl/docker-no-root': 'error', 'pawl/compose-no-version': 'off' }
})
```

`pawl explain docker-no-root` shows a check and how to fix what it finds.

## Markdown files

Pawl checks Markdown files itself too, with a line scan that skips code blocks, code spans, HTML comments and front matter. The checks follow the rules of the same names in `@eslint/markdown`.

| Check                                 | Level | What it finds                                                  |
| ------------------------------------- | ----- | -------------------------------------------------------------- |
| `pawl/markdown-no-empty-links`        | error | A link with no destination: `[text]()` or `[text](#)`          |
| `pawl/markdown-no-duplicate-headings` | off   | A heading with the same text as an earlier one in the document |
| `pawl/markdown-no-missing-label-refs` | off   | A reference such as `[text][label]` with no `[label]:` line    |

The two that are off were off in `@santi020k/eslint-config-basic` too. Turn them on in the policy:

```ts
export default definePolicy({
  rules: { 'pawl/markdown-no-duplicate-headings': 'warn' }
})
```

Biome checks the rest of Markdown under `strict`: `markdown/fenced-code-language` and `markdown/heading-increment` are in the [rules](/reference/rules/).
