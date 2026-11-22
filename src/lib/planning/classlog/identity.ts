/** A retry is the same reported class, not just the same outcomes. Planning estimates are deliberately excluded. */
export function classEntryIdentity(entry: {
  date: string; kind: string; note?: string | null; occurrence?: string | null
  items: { outcome: string; extent: string; note?: string | null; studied?: boolean | null }[]
}) {
  return JSON.stringify([
    entry.date, entry.kind, entry.note?.trim() || '', entry.occurrence || '',
    entry.items.map(i => [i.outcome, i.extent, i.note || '', i.studied === true]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  ])
}
