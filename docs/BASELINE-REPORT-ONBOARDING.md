# Database Baseline Report - Pre-Canonical Onboarding

**Date:** 2026-09-18
**Context:** Captured prior to running migrations for the Canonical Onboarding implementation.

## Counts
```json
{
  "Profiles by onboarding status": "{\"complete\":4,\"not_started\":1}",
  "Total Roadmaps": 6,
  "Total Plan Drafts": 0,
  "Total Planning Cycles": 0,
  "Total Commitments": 3,
  "Invalid weekdays in availability_rules": 0,
  "Registered profiles without exam_date": 0,
  "user_module_state rows from self_report": 77
}
```

## Observations
- 77 `user_module_state` rows were generated from self-report, demonstrating the current flaw of turning topic exposure into detailed module claims. We will preserve these but cease generating new ones this way.
- We have 4 `complete` profiles. Our migration will backfill default values for the new columns (`onboarding_context_version`, `class_pattern`) to ensure these users remain valid.
- There are no `plan_drafts` or `planning_cycles` so we don't have to worry about locking issues with existing active items.
