# For the question-bank owner: import format `reference-draft-bank.2`

**Status:** proposed, NOT applied. `scripts/reference-bank-import.cjs` is unchanged (SHA-256 starts `4211c5f0e7435ac9`).

**Why:** the current `output/question-bank/2027/draft-bank.json` is `.2` and the importer accepts only `.1`.

**Apply:** `git apply docs/patches/reference-bank-import-format-2.patch`

**What changes**
- Accepts `.1` and `.2`; names any other format as unsupported.
- `.2`: `held_out` must match `poolIntent`; `sourcePackId` and `packFactsHash` replace `sourceReferences`; `pp-mock1-` ids allowed only for held-out drafts.
- Held-out drafts: the FAMILY is created held out (items inherit the flag from their family), otherwise the database stores them as routine.
- A shared family is allowed only for variants with the same hint, outcome and pool (3 such pairs today).
- A retry also compares pool and family. The batch records the actual format as its prompt version.
- Unchanged: drafts only, provisional families, no approvals, no eligibility, one transaction.

**Please confirm:** (1) the 3 shared easy/medium pairs are intended to be one family each; (2) source-pack hashes are enough provenance for `.2` (no per-item page references).

**Proof:** `NODE_PATH=node_modules node <copy of the patched importer beside scripts/lib>` against disposable local databases; 33 checks in `docs/evidence/phase5-reference-bank-format2-verify.log` (verification script beside this file, expects the patched copy at `./b/scripts/`).
