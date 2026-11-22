'use client'

/** No data or error internals are guessed or exposed when a required read fails. */
export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <main className="standalone-page"><h1>This page could not be loaded</h1><p role="alert">Try loading the page again.</p>{error.digest && <p>Support reference <code>{error.digest}</code></p>}<button type="button" className="primary-button" onClick={retry}>Try again</button></main>
}
