'use client'

/** Renders without the app stylesheet (it replaces the root layout), so it carries its own small, theme-aware styles. */
const CSS = `
:root{color-scheme:light dark;--bg:#f4f4f6;--card:#fff;--ink:#1c1d21;--muted:#5d6068;--line:#dcdde2;--accent:#0062d6}
@media (prefers-color-scheme:dark){:root{--bg:#0b0b0d;--card:#18181b;--ink:#f4f4f6;--muted:#a3a6ad;--line:#2c2d33;--accent:#4d9bff}}
body{margin:0;background:var(--bg);color:var(--ink);font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:520px;margin:15vh auto;padding:32px;background:var(--card);border:1px solid var(--line);border-radius:22px;display:grid;gap:12px}
h1{margin:0;font-size:26px;letter-spacing:-.02em}p{margin:0;color:var(--muted);line-height:1.55}
button{justify-self:start;min-height:44px;padding:0 22px;border:0;border-radius:12px;background:var(--accent);color:#fff;font-weight:700;font-size:15px;cursor:pointer}
@media (max-width:560px){main{margin:16px;padding:24px}}
`
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <html lang="en"><body>
    <style>{CSS}</style>
    <main>
      <h1>Roadmap could not load</h1>
      <p role="alert">Try again in a moment.</p>
      {error.digest && <p>Support reference <code>{error.digest}</code></p>}
      <button type="button" onClick={retry}>Try again</button>
    </main>
  </body></html>
}
