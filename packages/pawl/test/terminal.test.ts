// cspell:ignore chek docter agnt verylongword
import { describe, expect, it } from 'vitest'
import { detectAgent, terminalFor } from '../src/cli/audience.ts'
import { wrap } from '../src/cli/ui.ts'
import {
  colorLevel,
  createStyle,
  padVisible,
  stripAnsi,
  truncate,
  unicodeSupported,
  visibleWidth
} from '../src/utils/terminal.ts'
import { andList, closest } from '../src/utils/text.ts'

const tty = { isTTY: true }

describe('colors', () => {
  it('follows NO_COLOR, FORCE_COLOR and what the terminal says it can show', () => {
    expect(colorLevel(tty, {})).toBe(1)
    expect(colorLevel(tty, { TERM: 'xterm-256color' })).toBe(2)
    expect(colorLevel(tty, { COLORTERM: 'truecolor' })).toBe(3)
    expect(colorLevel(tty, { TERM_PROGRAM: 'vscode' })).toBe(3)
    expect(colorLevel(tty, { NO_COLOR: '1', COLORTERM: 'truecolor' })).toBe(0)
    // An empty NO_COLOR does not count, as the convention says.
    expect(colorLevel(tty, { NO_COLOR: '' })).toBe(1)
    expect(colorLevel(tty, { TERM: 'dumb' })).toBe(0)
    expect(colorLevel({}, {})).toBe(0)
    expect(colorLevel({}, { FORCE_COLOR: '1' })).toBe(1)
    expect(colorLevel({}, { FORCE_COLOR: '3' })).toBe(3)
    expect(colorLevel(tty, { FORCE_COLOR: '0' })).toBe(0)
  })

  it('closes only what each paint opened, and paints nothing at level 0', () => {
    const style = createStyle(1)

    expect(style.red(`a ${style.dim('b')} c`)).toBe('\u001B[31ma \u001B[2mb\u001B[22m c\u001B[39m')
    expect(createStyle(0).accentBadge(' pawl ')).toBe(' pawl ')
    expect(createStyle(3).accent('x')).toBe('\u001B[38;2;181;242;58mx\u001B[39m')
    expect(createStyle(2).accent('x')).toBe('\u001B[38;5;155mx\u001B[39m')
  })

  it('draws symbols only where the terminal can', () => {
    expect(unicodeSupported({}, 'darwin')).toBe(true)
    expect(unicodeSupported({ TERM: 'linux' }, 'linux')).toBe(false)
    expect(unicodeSupported({}, 'win32')).toBe(false)
    expect(unicodeSupported({ WT_SESSION: 'x' }, 'win32')).toBe(true)
  })
})

describe('text on a terminal', () => {
  const red = createStyle(1).red

  it('measures, pads and cuts by what shows', () => {
    expect(stripAnsi(red('error'))).toBe('error')
    expect(visibleWidth(`${red('✖')} two`)).toBe(5)
    expect(padVisible(red('ab'), 4)).toBe(`${red('ab')}  `)
    expect(truncate('abcdefgh', 5)).toBe('abcd…')
    expect(truncate('abc', 5)).toBe('abc')
    expect(stripAnsi(truncate(red('abcdefgh'), 5))).toBe('abcd…')
    expect(truncate(red('abcdefgh'), 5)).toContain('\u001B[0m')
  })

  it('wraps at spaces and keeps a long word whole', () => {
    expect(wrap('one two three four', 9)).toEqual(['one two', 'three', 'four'])
    expect(wrap('a verylongword b', 5)).toEqual(['a', 'verylongword', 'b'])
    expect(wrap('first\nsecond', 20)).toEqual(['first', 'second'])
  })

  it('finds the word that was meant, and not one that is far off', () => {
    const commands = ['init', 'check', 'fix', 'sync', 'add', 'migrate', 'baseline', 'explain', 'doctor']

    expect(closest('chek', commands)).toBe('check')
    expect(closest('docter', commands)).toBe('doctor')
    expect(closest('base', commands)).toBe('baseline')
    expect(closest('nope', commands)).toBeUndefined()
    expect(closest('agnt', ['pretty', 'agent', 'editor', 'json'])).toBe('agent')
    expect(andList(['Biome', 'Oxlint', 'ESLint'])).toBe('Biome, Oxlint and ESLint')
  })
})

describe('who is running pawl', () => {
  it('knows the coding agents by the variables they set', () => {
    expect(detectAgent({})).toBeUndefined()
    expect(detectAgent({ CLAUDECODE: '1' })).toBe('Claude Code')
    expect(detectAgent({ CURSOR_AGENT: '1' })).toBe('Cursor')
    expect(detectAgent({ GEMINI_CLI: '1' })).toBe('Gemini CLI')
    expect(detectAgent({ CODEX_THREAD_ID: 'abc' })).toBe('Codex')
    // Amp sets Claude Code's variable too, and Qwen Code is a fork of Gemini CLI.
    expect(detectAgent({ AMP_CURRENT_THREAD_ID: 't', CLAUDECODE: '1' })).toBe('Amp')
    expect(detectAgent({ QWEN_CODE: '1', GEMINI_CLI: '1' })).toBe('Qwen Code')
    expect(detectAgent({ AGENT: 'goose' })).toBe('goose')
    expect(detectAgent({ AI_AGENT: '1' })).toBe('an agent')
    expect(detectAgent({ AGENT: '0' })).toBeUndefined()
    // Cursor sets this one in the terminals people type in too.
    expect(detectAgent({ CURSOR_TRACE_ID: 'x' })).toBeUndefined()
  })

  it('lets PAWL_AGENT settle it either way', () => {
    expect(detectAgent({ CLAUDECODE: '1', PAWL_AGENT: '0' })).toBeUndefined()
    expect(detectAgent({ PAWL_AGENT: '1' })).toBe('an agent')
    expect(detectAgent({ PAWL_AGENT: 'my-bot' })).toBe('my-bot')
  })

  it('gives a person at a terminal the full view, and an agent or a pipe plain text and no questions', () => {
    const both = { stdin: tty, stdout: { isTTY: true, columns: 200 } }
    const person = terminalFor({ TERM: 'xterm-256color' }, both, 'darwin')

    expect(person).toMatchObject({ agent: undefined, rich: true, animate: true, interactive: true, width: 120 })
    expect(person.style.level).toBe(2)
    expect(person.sym.tick).toBe('✔')

    const agent = terminalFor({ CLAUDECODE: '1', TERM: 'xterm-256color' }, both, 'darwin')

    expect(agent).toMatchObject({ agent: 'Claude Code', rich: false, animate: false, interactive: false })
    expect(agent.style.level).toBe(0)

    expect(terminalFor({}, { stdin: tty, stdout: {} }, 'darwin')).toMatchObject({ rich: false, interactive: false })
    expect(terminalFor({ CI: 'true' }, both, 'darwin')).toMatchObject({
      rich: true,
      animate: false,
      interactive: false
    })
    // Colors forced into a pipe still get the full view, without a spinner.
    expect(terminalFor({ FORCE_COLOR: '1' }, { stdin: {}, stdout: {} }, 'darwin')).toMatchObject({
      rich: true,
      animate: false
    })
  })
})
