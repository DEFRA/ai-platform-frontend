import Blankie from 'blankie'

import { config } from '#/config/config.js'

// Chrome enforces CSP form-action against the redirect target of a form
// submission too, not just the initial action URL - sign-out posts to '/sign-out'
// then gets redirected to Entra ID's (or the mock provider's) end-session URL, so
// that origin must be allowed here or the redirect is silently blocked.
const mockIssuerUrl = config.get('azureAd.mockIssuerUrl')
const formActionSources = ['self', 'https://login.microsoftonline.com']
if (mockIssuerUrl && !config.get('isProduction')) {
  formActionSources.push(mockIssuerUrl)
}

/**
 * Manage content security policies.
 * @satisfies {import('@hapi/hapi').Plugin}
 */
const contentSecurityPolicy = {
  plugin: Blankie,
  options: {
    // Hash 'sha256-GUQ5ad8JK5KmEWmROf3LZd9ge94daqNvd8xy9YS1iDw=' is to support a GOV.UK frontend script bundled within Nunjucks macros
    // https://frontend.design-system.service.gov.uk/import-javascript/#if-our-inline-javascript-snippet-is-blocked-by-a-content-security-policy
    defaultSrc: ['self'],
    fontSrc: ['self', 'data:'],
    connectSrc: ['self', 'wss', 'data:'],
    mediaSrc: ['self'],
    styleSrc: ['self'],
    scriptSrc: [
      'self',
      "'sha256-GUQ5ad8JK5KmEWmROf3LZd9ge94daqNvd8xy9YS1iDw='"
    ],
    imgSrc: ['self', 'data:'],
    frameSrc: ['self', 'data:'],
    objectSrc: ['none'],
    frameAncestors: ['none'],
    formAction: formActionSources,
    manifestSrc: ['self'],
    generateNonces: false
  }
}

export { contentSecurityPolicy }
