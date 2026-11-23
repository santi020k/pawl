/** Each doc page as Markdown at its URL plus ".md", such as /guide/getting-started.md, for coding agents. */
import { type APIRoute, type GetStaticPaths, type InferGetStaticPropsType } from 'astro'

import { docs, pageMarkdown, textResponse } from './_llms.ts'

export const getStaticPaths = (async () =>
  (await docs()).map(doc => ({ params: { slug: doc.id }, props: { doc } }))) satisfies GetStaticPaths

type Props = InferGetStaticPropsType<typeof getStaticPaths>

export const GET: APIRoute<Props> = ({ props }) => textResponse(pageMarkdown(props.doc), 'markdown')
