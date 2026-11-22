# Content authoring without a publisher dependency

## Proposed operating decision

Roadmap need not depend on a publisher's books as its authoring input. Build original diagnostic items and recall prompts using independently authored knowledge packs, or third-party sources whose terms permit the intended commercial and AI uses. Keep a record of that basis. For work actually owned by Roadmap, the relevant authority can be its author/rightsholder; it need not be CFA Institute or Kaplan.

This is a change of content sourcing, not a bypass that marks the three current book-derived packs cleared. Those packs and their dependent candidates stay quarantined until their applicable use is resolved. This document does not grant permission or certify ownership of any existing item.

## Why “we are not teaching” is insufficient

Indian copyright guidance distinguishes ideas/concepts from their expression. That supports creating original assessment material about financial concepts rather than copying a particular book's explanations, examples, questions or arrangement. It does not mean all uses of a book become permissible when the product calls itself a planner. See the [Copyright Office handbook](https://copyright.gov.in/Documents/handbook.html) and [WIPO's explanation of copyright protection](https://www.wipo.int/en/web/copyright/protection).

Section 52 contains specific exceptions, including private/personal research and certain instructional/examination uses. Their application is fact-dependent; they are not a blanket clearance for a commercial AI authoring pipeline. See [Section 52 published by IP India](https://ipindia.gov.in/acts/copyright-act-1957/section-52-2).

CFA Institute's current website terms expressly restrict using site material for AI training, grounding and related operations. That is a reason to check access/licence terms separately from whether facts are copyrightable. It is not a finding that every uploaded PDF has those same contractual terms. See [CFA Institute's terms](https://www.cfainstitute.org/about/governance/policies/terms-conditions). Have an Indian IP adviser confirm the intended production sourcing/licence approach before commercial use of third-party material.

## Four distinct content paths

| Path | Practical workflow | Required record / limits |
| --- | --- | --- |
| Independently authored Roadmap content | An author writes a concept/fact pack and original scenarios without using unlicensed books/questions as the model input. AI may draft against that pack; a human checks the result. | Author/rightsholder, origin, version/hash, permission/assignment or other documented basis for Roadmap's intended use. Retain concept and exact-item review. An automated statement “we own this” is not proof. |
| Licensed or suitably open material | Validate the licence for the actual excerpt/data and intended commercial, derivative and AI uses. | Specific source/version, licence/permission and attribution requirements. Publicly accessible is not necessarily openly licensed; an NC licence does not permit ordinary commercial reuse. |
| A student's own notes and recall cards | Private note-taking and optional card drafting from the student's selected text. Cards remain editable drafts until the student saves them. | Account ownership, explicit generation action and permitted-use/privacy boundary. Do not reuse private notes as a shared question bank or training dataset. A pasted third-party passage is not made Roadmap-owned by being in a private note. |
| Current unconfirmed book-derived packs | Retain provenance and quarantine; do not use them for live student generation/publication without an established basis. | No mass relabelling, paraphrase laundering or automatic concept/item approval. A prompt that says “do not quote” alone does not clear the input use. |

## Implement with the existing pipeline

The current source-pack contract already records `rights.state`, `authority` and `permittedUse`; it can represent genuinely authorised first-party inputs. “Authority” should mean the person/entity and actual basis supporting that input use, rather than a universal requirement for publisher approval. Do not add a `skipRights`, `plannerOnly` or equivalent override.

Use a small internal checklist per pack: source origin → intended uses → evidence/reference to authority or licence → edition/scope → immutable version/hash → concept sign-off → original candidate → quality checks → exact-version human publication. Only mark `cleared` when the record is supportable. Do not describe AI-produced wording as necessarily copyright-owned; establish the applicable use/ownership position for that work.

Reuse the three existing R32 packs only under their actual recorded status. If a clean first-party replacement is written, give it a new identity/version and truthful lineage; do not rename an extract to conceal its origin. The private authoring tools can support both paths without a student Materials tab.

## Curriculum and flashcards

The student experience is a compact study tracker and workspace: what was covered, what the tests support, where to focus next, personal notes and short recall cards. It is not a chapter library or teaching course.

- Tracking identifiers, curriculum alignment and student-facing labels need their own provenance; do not assume removing lessons settles every content/licence question.
- Generate recall cards from selected, permitted inputs, not hidden access to the uploaded books. A no-input state should offer manual cards or the student's own note text.
- Private card confidence/review ratings affect recall scheduling only. They do not create diagnostic evidence, repair closure or pass predictions.
- Do not publish proprietary worked examples, long excerpts, whole-chapter explanations or copied mock questions as “flashcards.”

## Effect on launch readiness

This approach removes the architectural requirement to obtain **publisher** permission for every original item. It does not manufacture the missing real bank. Authorised grounding, human concept validation, item review and enough independent families are still needed. The planner, tracker, private notes and manual flashcards can work while diagnostics honestly state their current scope/availability.

Rights decisions and human review remain internal authoring controls, not an access test imposed on ordinary students. Planning access must not depend on question-bank availability.
