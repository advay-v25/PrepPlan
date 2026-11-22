import type { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: '*', disallow: ['/app/', '/app$', '/api/', '/onboarding', '/account', '/auth/', '/login', '/signup', '/check-email', '/forgot-password', '/update-password', '/not-invited'] } }
}
