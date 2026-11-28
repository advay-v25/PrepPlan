# Intermittent browser failure · desktop Calendar keyboard placement (cause found, FIXED)

**Test:** `tests/e2e/lifecycle/phase6-completion.spec.ts:48` "Calendar: keyboard placement and resize…", desktop, 26 Nov 2026, fixture-bank dev server behind the fault proxy (no fault active).
**Failure:** line 78, `expect(saved.starts_at).toBeTruthy()` received `null`; `duration_minutes` was the expected 44.
**Frequency seen:** 1 failure in 4 desktop runs of this test (3 of 3 immediate repeats passed); the 390 px run in the same session passed.

## What the trace shows
- Page `GET /app/calendar?…&task=<owned>` started 10:51:06.407Z (394 ms); the drawer was server-rendered from the URL.
- The test filled **Start** with `19:00` about 0.1 s after that response, saw Length `44`, pressed Enter on Apply.
- The app sent `PATCH /api/tasks/<owned>` with `{"action":"move","date":"2026-11-27","startMinutes":null,"durationMinutes":44,"expectedRevision":1}` and got 200; the server saved exactly that (`starts_at: null`).

## Cause (established 26 Nov, later the same day) · FIXED
Reproduced on every run at both widths on the unchanged code (`phase5-calendar-save-reproduced-2026-11-26.log`): with the page's scripts held back, a time typed into the server-rendered drawer stayed visible in the field but never reached React state; Apply then sent `startMinutes: null`. A half-typed time had the same silent result (it reads as empty and was saved as day-only).
**Fix** (`TaskDetailDrawer.tsx`): the drawer's controls are disabled, and say so, until React is attached; Apply reads what is on screen; a half-typed time is refused with the input kept. Clearing the field still saves day-only.
**Regression:** `tests/e2e/lifecycle/phase5-calendar-save.spec.ts` asserts both the request and the saved row, desktop and 390 px.
Other server-rendered forms were not audited for the same pattern.

---

# Second intermittent · 390 px Calendar agenda hydration mismatch (cause OPEN)

**Run:** `phase6-completion`, mobile-390, final fault-harness pass on source `729306d501b39904`, 26 Nov 2026 14:40Z (fixture-bank dev server behind the fault proxy).
**Symptom:** the file's end-of-run error collector (it reports under the last test, "Settings app-wide…", whose own assertions passed) caught one console error on `/app/calendar?week=2026-11-26&view=agenda#calendar-today`: "A tree hydrated but some attributes of the server rendered HTML didn't match the client properties."
**Frequency seen:** once. Not reproduced in 24 further runs of the Settings, Calendar and Account tests at both widths (plain dev server, full message capture on).
**Evidence:** `phase5-intermittent-hydration-2026-11-26.json`. The collector kept only the first 200 characters, so the differing element is NOT recorded.
**Not established:** whether this round's work is involved. Calendar's additions from Phase 5 are server components; an earlier, different Calendar hydration fault (the "now" line, 19 Nov) was fixed.
**Capture in place:** the shared `login` helper now appends every hydration error in full, with URL, viewport, browser and runner time zones, to `docs/evidence/hydration-captures.jsonl` (`captureHydration` in `tests/e2e/lifecycle/helpers.ts`). It stays open until a capture explains it. The Calendar save fix is a different mechanism and is not claimed to resolve it.

## Phase 6, 27 Nov 2026 · still OPEN
288 dev-server sequences of Settings → Calendar, the exact agenda deep link and past week → Today (144 at 390 px; three browser time zones; local date boundary; slow and normal loads): 0 hydration messages (`phase6-hydration-attempts-summary-2026-11-27.json`).
A separate mismatch with the same message was reproduced and fixed: a disclosure opened before React arrived (`phase6-hydration-disclosure-reproduced-2026-11-27.log`). Whether that was this occurrence is not established, because the element was never recorded.

