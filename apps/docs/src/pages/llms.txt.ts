/** https://pawl.santi020k.com/llms.txt: what pawl is, and a link to every doc page as Markdown (https://llmstxt.org). */
import { type APIRoute } from 'astro'

import { llmsIndex, textResponse } from './_llms.ts'

export const GET: APIRoute = async () => textResponse(await llmsIndex(), 'plain')
