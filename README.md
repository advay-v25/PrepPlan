# Roadmap — CFA Level I learning control system

Interactive CFA Level I planning and evidence demo based on `PRD-v1.md`. Every tab is wired to one locally persisted candidate state; no API keys are required to explore it.

See `IMPLEMENTATION-GUIDE.md` and `.env.example` for the production architecture and service keys.

## Run locally

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:4173`.

## Included in this draft

- Home dashboard focused on pace, next actions, weakest-link diagnosis, and preparedness
- Week-based study plan with class, study, diagnostic, risk, and buffer states
- Syllabus evidence view
- Subject-selected diagnostic generation
- Real-time adaptive next-question selection using answers, confidence, difficulty, module misses, and prerequisite priority
- Original CFA Level I-style draft items across Fixed Income, Quantitative Methods, FSA, Equities, and Ethics
- Immediate answer feedback, evidence capture, root-cause result, and proposed plan diff
- Material mapping/import surface
- Evidence-grounded coach surface
- Responsive desktop and mobile layouts

## Diagnostic architecture

The browser prototype uses a deterministic adaptive engine in `src/diagnosticEngine.ts`. This makes the selection behavior real and testable without pretending that an external AI service is connected.

Production should replace the draft bank/provider boundary with:

1. a reviewed, versioned item bank keyed to official LOS;
2. a server-side diagnostic-selection service;
3. an LLM only for constrained question drafting, misconception classification, and explanation grading;
4. mandatory editorial validation before any generated question becomes scored evidence;
5. per-user item-exposure tracking and a no-repeat window;
6. persisted attempts, module state, score snapshots, and plan changes.

The scheduler and Preparedness Index should remain deterministic. The model may explain or propose; it must not silently place blocks or alter evidence.

## Checks

```bash
npm run lint
npm run build
```
