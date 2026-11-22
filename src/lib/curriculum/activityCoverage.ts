import type { StudyActivityBlock, ActivityObservation } from './studyActivity'

/** Reading completion requires every outcome, not one sitting or one checkbox. */
export function activityCoverage(blocks: StudyActivityBlock[], observations: ActivityObservation[], readingOf: Map<string,string>, pending: Set<string>) {
  const blockOf=new Map(blocks.map(b => [b.id,b])), exposed=new Set<string>(),studied=new Set<string>()
  for(const o of observations){
    const b=blockOf.get(o.blockId)
    if(!b || b.cancelled_at || b.execution!=='completed' || (b.scope_group_id && pending.has(b.scope_group_id)))continue
    exposed.add(o.outcomeId)
    if(b.activityKind!=='class')studied.add(o.outcomeId)
  }
  const grouped=new Map<string,string[]>()
  for(const [id,r] of readingOf)grouped.set(r,[...(grouped.get(r)??[]),id])
  const result=new Map<string,'taught'|'studied'>()
  for(const [r,ids] of grouped){
    if(ids.every(id=>studied.has(id)))result.set(r,'studied')
    else if(ids.every(id=>exposed.has(id)))result.set(r,'taught')
  }
  return result
}
