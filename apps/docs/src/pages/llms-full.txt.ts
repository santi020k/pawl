/** https://pawl.santi020k.com/llms-full.txt: every doc page as Markdown, in one file. */
import { type APIRoute } from 'astro'

import { llmsFull, textResponse } from './_llms.ts'

export const GET: APIRoute = async () => textResponse(await llmsFull(), 'plain')
