import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { test } from 'node:test'

test('the installed Worker fetch consumer rejects tampered integrity-protected content', async () => {
  const docsRequire = createRequire(new URL('../apps/docs/package.json', import.meta.url))
  const workerRequire = createRequire(docsRequire.resolve('wrangler'))
  const consumerRequire = createRequire(workerRequire.resolve('miniflare'))
  const consumer: unknown = consumerRequire('undici')
  assert.ok(consumer !== null && typeof consumer === 'object' && 'fetch' in consumer)
  assert.equal(typeof consumer.fetch, 'function')
  if (typeof consumer.fetch !== 'function') throw new Error('The Worker fetch consumer is unavailable')

  const body = 'Synthetic downloaded asset'
  const digest = createHash('sha256').update(body).digest('base64')
  const integrity = `\tsha256-${digest}\r\n`
  const server = createServer((request, response) => {
    response.end(request.url === '/valid' ? body : 'Modified asset')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  try {
    const address = server.address()
    assert.ok(address !== null && typeof address === 'object')
    const origin = `http://127.0.0.1:${address.port}`
    const response: unknown = await consumer.fetch(`${origin}/valid`, { integrity })
    assert.ok(response !== null && typeof response === 'object' && 'text' in response)
    if (typeof response.text !== 'function') throw new Error('The Worker fetch response has no text reader')
    const received: unknown = await response.text()
    assert.equal(received, body)
    await assert.rejects(
      async () => {
        if (typeof consumer.fetch !== 'function') throw new Error('The Worker fetch consumer is unavailable')
        await consumer.fetch(`${origin}/modified`, { integrity })
      },
      (error: unknown) =>
        error instanceof TypeError && error.cause instanceof Error && /integrity mismatch/u.test(error.cause.message)
    )
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())))
  }
})
