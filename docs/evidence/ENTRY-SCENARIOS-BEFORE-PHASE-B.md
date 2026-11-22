# Adaptive-entry scenarios — the planner BEFORE Phase B (captured evidence)

**This is a captured record, not a script output.** On 1 Nov 2026, before Phase B changed the roadmap planner, `scripts/entry-scenarios-baseline.ts`
was run against the then-current `buildRoadmap` and its output was copied here. That script has been removed: running it today would execute the
*current* planner and print today's behaviour as if it were the old implementation's. To see today's behaviour use `scripts/entry-scenarios-after.ts`
(it says it runs the current planner).

Inputs (identical in every scenario): six topics × three readings, 600 weekly minutes, self-study, plan starting 2 Nov 2026.

| # | Scenario | Phases (weeks) before Phase B | Milestones | What could not be expressed |
|---|----------|-------------------------------|-----------|-----------------------------|
| 1 | Fresh candidate, exam 2 Aug 2027 | first pass 20, consolidation 4, revision 7, final 8 | — | — (unchanged by Phase B) |
| 2 | Three subjects covered, exam 2 Aug 2027 | identical to scenario 1: first pass 20 | 16 | uncertainty; covered subjects still got first-pass weeks |
| 3 | First pass complete, mock in a month, exam 22 Feb 2027 (~16 weeks) | first pass 5, consolidation 1, revision 2, final 8 | 9 | the mock; a first pass for work already done |

Scenario 2 and 3 "FAIL" rows in the original run were the Phase B targets ("uncertainty is expressible", "mock checkpoint expressible", "first pass shrinks").
After-state is asserted by `npm run entry:test` and printed by `scripts/entry-scenarios-after.ts`.
