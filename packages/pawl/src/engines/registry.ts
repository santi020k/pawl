import { type Toolset } from '../project/toolset.ts'
import { biome } from './biome/engine.ts'
import { type Engine } from './engine.ts'
import { eslint } from './eslint/engine.ts'
import { oxlint } from './oxlint/engine.ts'
import { prettier } from './prettier/engine.ts'

/** Every engine pawl drives, in the order they run. */
export const ENGINES: readonly Engine[] = [biome, oxlint, eslint, prettier]

/** The engines a project's tools call for. */
export const activeEngines = (tools: Toolset): Engine[] => ENGINES.filter(engine => engine.active(tools))
