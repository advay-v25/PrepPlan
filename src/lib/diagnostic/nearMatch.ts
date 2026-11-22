/**
 * Reviewer hint only: items of the same concept whose wording is close once figures are masked. A text match is NOT a family and NOT proof
 * of independence; a person decides construction. Rewording, new figures and close scenario siblings can all score high.
 * Limit: heavy rewording can fall below the threshold; absence of a hint is not evidence of independence.
 */
const words = (stem: string, options: string[]) =>
  new Set([stem, ...options].join(' ').toLowerCase().replace(/[\d.,$%()]+/g, '#').replace(/[^a-z#\s]/g, ' ').split(/\s+/).filter(w => w.length > 2))

export function similarity(a: { stem: string; options: string[] }, b: { stem: string; options: string[] }): number {
  const x = words(a.stem, a.options), y = words(b.stem, b.options)
  if (!x.size || !y.size) return 0
  let hit = 0; for (const w of x) if (y.has(w)) hit++
  return hit / (x.size + y.size - hit)
}

export function nearMatches<T extends { id: string; stem: string; options: string[] }>(self: { id: string; stem: string; options: string[] }, others: T[], threshold = 0.2): (T & { similarity: number })[] {
  return others.filter(o => o.id !== self.id).map(o => ({ ...o, similarity: similarity(self, o) })).filter(o => o.similarity >= threshold).sort((p, q) => q.similarity - p.similarity).slice(0, 8)
}
