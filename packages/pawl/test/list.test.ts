import { describe, expect, it } from 'vitest'
import { mapAsync } from '../src/utils/list.ts'

/** A task that records when it starts and ends, and ends only when the test lets it. */
const tracked = (): {
  events: string[]
  task: (name: string) => Promise<string>
  finish: (name: string) => void
} => {
  const events: string[] = []
  const waiting = new Map<string, () => void>()

  return {
    events,
    task: name =>
      new Promise<string>(resolve => {
        events.push(`start ${name}`)
        waiting.set(name, () => {
          events.push(`end ${name}`)
          resolve(name.toUpperCase())
        })
      }),
    finish: name => waiting.get(name)?.()
  }
}

/** Let the promise callbacks that are due run. */
const settle = (): Promise<void> => new Promise(resolve => setImmediate(resolve))

describe('mapAsync', () => {
  it('starts every task at once and keeps the order of the items, whichever ends first', async () => {
    const { events, task, finish } = tracked()
    const results = mapAsync(['a', 'b', 'c'], task, { together: true })

    await settle()
    expect(events).toEqual(['start a', 'start b', 'start c'])

    finish('c')
    finish('a')
    finish('b')

    expect(await results).toEqual(['A', 'B', 'C'])
    expect(events.slice(3)).toEqual(['end c', 'end a', 'end b'])
  })

  it('starts a task only when the one before it has ended', async () => {
    const { events, task, finish } = tracked()
    const results = mapAsync(['a', 'b'], task, { together: false })

    await settle()
    expect(events).toEqual(['start a'])

    finish('a')
    await settle()
    expect(events).toEqual(['start a', 'end a', 'start b'])

    finish('b')

    expect(await results).toEqual(['A', 'B'])
  })

  it('rejects with the error of a task that fails', async () => {
    const fail = (name: string): Promise<string> =>
      name === 'b' ? Promise.reject(new Error('b failed')) : Promise.resolve(name)

    await expect(mapAsync(['a', 'b'], fail, { together: true })).rejects.toThrow('b failed')
    await expect(mapAsync(['a', 'b'], fail, { together: false })).rejects.toThrow('b failed')
  })

  it('gives an empty list for no items', async () => {
    expect(await mapAsync([], (item: string) => Promise.resolve(item), { together: true })).toEqual([])
  })
})
