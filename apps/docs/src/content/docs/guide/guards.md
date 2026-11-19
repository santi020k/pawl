---

title: Guards and Docker checks
description: Checks that need no plugin, for the libraries a project uses and for its Docker files.
---

## Guards

A guard is a set of checks for one library. It needs no plugin, and switches on when the project depends on the library.

| Guard                                          | On when the project uses                 | What it refuses                                                     |
| ---------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------- |
| `ai-keys`                                      | Any AI SDK below                         | An API key written in the code, and `dangerouslyAllowBrowser: true` |
| `ai-sdk`                                       | `ai`, `@ai-sdk/*`                        | Imports of package internals                                        |
| `openai`, `anthropic`                          | `openai`, `@anthropic-ai/sdk`            | Imports of package internals                                        |
| `openai-agents`                                | `@openai/agents`                         | Internals, and agents from the base OpenAI client                   |
| `google-genai`                                 | `@google/genai`, `@google/generative-ai` | Internals, and the legacy SDK                                       |
| `langchain`, `llamaindex`, `mastra`, `autogen` | Those packages                           | Imports of package internals                                        |
| `mcp`                                          | `@modelcontextprotocol/sdk`              | Imports of internal modules                                         |
| `hono`                                         | `hono`                                   | Internals, and a hand-written wildcard CORS header                  |

Import restrictions run in whichever linter you use. Code patterns run in Biome as rules pawl writes itself into `.pawl/rules/`, or in ESLint. With Oxlint as the only linter they do not run, and `pawl doctor` says so.

`de-morgan` is an opt-in guard: `pawl add de-morgan` flags `!(a && b)` and `!(a || b)` with no plugin.

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
