import { type Runtime } from '../types.ts'

export const RUNTIMES: readonly Runtime[] = ['node', 'browser', 'bun', 'deno', 'worker']

/** Globals every runtime pawl knows has: the web platform APIs Node, browsers, Bun, Deno and workers share. */
const SHARED = [
  'console',
  'globalThis',
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
  'queueMicrotask',
  'structuredClone',
  'performance',
  'fetch',
  'URL',
  'URLSearchParams',
  'TextEncoder',
  'TextDecoder',
  'AbortController',
  'AbortSignal',
  'Event',
  'EventTarget',
  'CustomEvent',
  'FormData',
  'Headers',
  'Request',
  'Response',
  'Blob',
  'File',
  'ReadableStream',
  'WritableStream',
  'TransformStream',
  'WebSocket',
  'BroadcastChannel',
  'MessageChannel',
  'MessagePort',
  'crypto',
  'atob',
  'btoa',
  'navigator'
]

/**
 * The globals of each runtime, for engines that need a list. `globals` names the keys of the
 * `globals` package a project may have, which ESLint uses in full when it is installed;
 * `own` is pawl's short list for when it is not. `extra` are names neither Biome nor that package know.
 * `oxlint` names Oxlint's own environments.
 */
export const RUNTIME_GLOBALS: Record<Runtime, { globals: string[]; oxlint: string[]; own: string[]; extra: string[] }> =
  {
    node: {
      globals: ['node'],
      oxlint: ['node'],
      own: [
        'process',
        'Buffer',
        'global',
        '__dirname',
        '__filename',
        'module',
        'require',
        'exports',
        'setImmediate',
        'clearImmediate'
      ],
      extra: []
    },
    browser: {
      globals: ['browser'],
      oxlint: ['browser'],
      own: [
        'window',
        'self',
        'document',
        'location',
        'history',
        'localStorage',
        'sessionStorage',
        'alert',
        'confirm',
        'prompt',
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'requestIdleCallback',
        'getComputedStyle',
        'matchMedia',
        'customElements',
        'IntersectionObserver',
        'MutationObserver',
        'ResizeObserver',
        'HTMLElement',
        'Element',
        'Node',
        'Worker'
      ],
      extra: []
    },
    bun: {
      globals: ['node'],
      oxlint: ['node'],
      own: ['process', 'Buffer', 'require', 'module', 'exports', '__dirname', '__filename', 'setImmediate'],
      extra: ['Bun']
    },
    deno: { globals: ['shared-node-browser'], oxlint: ['shared-node-browser'], own: ['self'], extra: ['Deno'] },
    worker: {
      globals: ['serviceworker'],
      oxlint: ['serviceworker'],
      own: ['self', 'caches', 'addEventListener', 'removeEventListener'],
      // Cloudflare Workers adds these to the service worker globals.
      extra: ['HTMLRewriter', 'WebSocketPair']
    }
  }

/** Names no engine knows by itself, which every engine is told about. */
export const extraGlobals = (runtimes: readonly Runtime[]): string[] =>
  [...new Set(runtimes.flatMap(runtime => RUNTIME_GLOBALS[runtime].extra))].sort()

/** Pawl's own list of the globals of these runtimes, for ESLint when the `globals` package is not installed. */
export const ownGlobals = (runtimes: readonly Runtime[]): string[] => [
  ...new Set([
    ...SHARED,
    ...runtimes.flatMap(runtime => [...RUNTIME_GLOBALS[runtime].own, ...RUNTIME_GLOBALS[runtime].extra])
  ])
]

/** Oxlint's environments for these runtimes, with the latest ECMAScript globals. */
export const oxlintEnv = (runtimes: readonly Runtime[]): Record<string, boolean> =>
  Object.fromEntries(
    ['builtin', ...new Set(runtimes.flatMap(runtime => RUNTIME_GLOBALS[runtime].oxlint))].sort().map(env => [env, true])
  )
