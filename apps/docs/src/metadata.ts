/**
 * The site facts that the landing page and the doc pages share, for @santi020k/og's metadata and JSON-LD helpers.
 * astro.config.mjs keeps its own copy of the URL and description, which Starlight reads.
 */
import { defineSchema, offerSchema, personSchema, softwareApplicationSchema, webSiteSchema } from '@santi020k/og/schema'

// The published package, so the structured data names the version on npm without a second copy to keep in step.
import pawlPackage from '../../../packages/pawl/package.json'

export const siteUrl = 'https://pawl.santi020k.com'
export const siteName = 'pawl'
export const siteDescription =
  'Fast guardrails for AI-written code: one lint and format standard for Biome, Oxlint, ESLint and Prettier, with a baseline so only new findings fail.'
export const locale = 'en_US'

/** The facts of the published package that the site repeats: its name, version, summary and the Node versions it runs on. */
export const npmPackage = {
  name: pawlPackage.name,
  version: pawlPackage.version,
  description: pawlPackage.description,
  node: pawlPackage.engines.node
}

export const repositoryUrl = 'https://github.com/santi020k/pawl'
export const npmUrl = `https://www.npmjs.com/package/${npmPackage.name}`
const licenseUrl = 'https://opensource.org/licenses/MIT'

// The same directives @santi020k/og writes for an indexable page: allow the large social image and full snippets.
export const indexRobots = 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1'

export const author = personSchema(
  { id: `${siteUrl}/#author`, name: 'Santiago Molina', url: 'https://santi020k.com' },
  { alternateName: 'santi020k' }
)

export const website = webSiteSchema({
  id: `${siteUrl}/#website`,
  name: siteName,
  url: `${siteUrl}/`,
  description: siteDescription,
  inLanguage: 'en',
  publisher: author
})

const softwareId = `${siteUrl}/#software`

/** The CLI as a product: what search engines and assistants should know pawl is, with its npm and GitHub pages. */
export const software = softwareApplicationSchema(
  {
    id: softwareId,
    name: siteName,
    url: `${siteUrl}/`,
    description: npmPackage.description,
    applicationCategory: 'DeveloperApplication',
    operatingSystem: 'Node.js',
    softwareVersion: npmPackage.version,
    isAccessibleForFree: true,
    offers: offerSchema({ price: 0, currency: 'USD' }),
    author
  },
  {
    alternateName: npmPackage.name,
    image: `${siteUrl}/og.jpg`,
    license: licenseUrl,
    sameAs: [repositoryUrl, npmUrl],
    softwareRequirements: `Node.js ${npmPackage.node}`
  }
)

/** The repository the package is built from. */
export const sourceCode = defineSchema({
  '@type': 'SoftwareSourceCode',
  '@id': `${siteUrl}/#source`,
  name: siteName,
  url: repositoryUrl,
  codeRepository: repositoryUrl,
  programmingLanguage: 'TypeScript',
  runtimePlatform: 'Node.js',
  license: licenseUrl,
  author,
  targetProduct: defineSchema({ '@type': 'SoftwareApplication', '@id': softwareId, name: siteName })
})

/** A reference to the software node, for doc pages that are about it without repeating every property. */
export const softwareReference = defineSchema({ '@type': 'SoftwareApplication', '@id': softwareId, name: siteName })
