# Superseded diagnostic stack

This was a second, parallel item-generation pipeline living one letter away from
the real one (`src/lib/diagnostics/` vs `src/lib/diagnostic/`). It had its own
hardcoded model default, its own item schema, and its own API route, and nothing
imported its entry point — `DiagnosticFlow.tsx` was rendered by no route.

Two competing pipelines a letter apart is how the original confusion happened,
so it was moved out of `src/` rather than left to be found and edited by
mistake. Nothing referenced any of it at the time of the move:

- `DiagnosticFlow.tsx` — imported by nothing
- `lib-diagnostics/blueprint.ts` — imported only by the route below
- `api-diagnostics/generate/route.ts` — called only by DiagnosticFlow
- `diagnosticEngine.ts` — imported only by DiagnosticFlow

The live pipeline is `src/lib/diagnostic/` (generator, verifier, blueprintPlan)
with `scripts/pilot-generation-run.ts`.
