import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { SourcePack } from './groundingPacket'

/**
 * Source packs are plain JSON files selected by EXACT canonical id (concept first, then outcome). Nothing is searched or embedded.
 * `content/source-packs/private/` holds internal reference extracts and is git-ignored; its packs keep their recorded rights state.
 */
export const SOURCE_PACK_DIR = 'content/source-packs'

export function loadSourcePacks(root = SOURCE_PACK_DIR): SourcePack[] {
  if (!existsSync(root)) return []
  const out: SourcePack[] = []
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(dir, e.name))
      else if (e.name.endsWith('.json')) {
        const p = JSON.parse(readFileSync(join(dir, e.name), 'utf8')) as SourcePack
        if (p && p.packId && p.outcomeId && Array.isArray(p.facts)) out.push(p)
      }
    }
  }
  walk(root)
  return out
}

/** Exact selection: a pack naming this concept wins; otherwise the outcome-level pack; otherwise null (the caller emits a blocker). */
export function selectPack(packs: SourcePack[], outcomeId: string, conceptId: string): SourcePack | null {
  return packs.find(p => p.conceptId === conceptId && p.outcomeId === outcomeId) ?? packs.find(p => !p.conceptId && p.outcomeId === outcomeId) ?? null
}
