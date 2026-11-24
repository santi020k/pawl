import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { type Benchmarks, median, summarize, table } from './bench.ts'

describe('the benchmark numbers', () => {
  it('take the median of odd and even counts, and round each summary', () => {
    assert.equal(median([3, 1, 2]), 2)
    assert.equal(median([4, 1, 3, 2]), 2.5)
    assert.deepEqual(summarize({ id: 'a', label: 'A', runs: [10.4, 12.6, 11.2] }), {
      id: 'a',
      label: 'A',
      medianMs: 11,
      minMs: 10,
      maxMs: 13
    })
  })

  it('print one row per case', () => {
    assert.equal(
      table([{ id: 'a', label: 'A', medianMs: 1, minMs: 1, maxMs: 2 }]).split('\n')[2],
      '| A | 1 ms | 1 ms | 2 ms |'
    )
  })

  it('on the page come from a run of the script, with every case', () => {
    const data = JSON.parse(
      readFileSync(new URL('../apps/docs/src/data/benchmarks.json', import.meta.url), 'utf8')
    ) as Benchmarks

    assert.match(data.date, /^\d{4}-\d{2}-\d{2}$/)
    assert.ok(data.runs >= 3)
    assert.deepEqual(
      data.results.map(result => result.id),
      ['biome-alone', 'pawl-biome', 'pawl-oxlint', 'pawl-eslint', 'hook']
    )

    for (const result of data.results)
      assert.ok(result.minMs <= result.medianMs && result.medianMs <= result.maxMs, result.id)
  })
})
