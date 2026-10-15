-- Answer keys were world-readable.
--
-- assessment_items carried "items_select_all ... using (true)" plus table-level
-- SELECT for anon and authenticated. Verified against the live database with
-- nothing but the public URL and the public anon key: an anonymous client could
-- read key_index, per_option_feedback (whose text begins "Correct." on the key),
-- and item_card (which holds the worked solution) for every item in the bank.
--
-- That is not a leak of one question. It makes every diagnostic score
-- meaningless, and evidence derived from those scores is the thing the whole
-- product rests on.
--
-- Every server read of this table already goes through the service-role client,
-- which bypasses RLS, so no application code depends on public access. Items
-- reach a learner only through the API, which withholds the key by construction.

drop policy if exists "items_select_all" on public.assessment_items;

-- RLS alone is not enough: a table-level grant is what PostgREST checks first,
-- and "no policy" plus "has grant" still exposes the table's shape.
revoke all on public.assessment_items from anon, authenticated;

-- form_items lists which items make up a form. Harmless with item bodies locked,
-- but nothing reads it with a user-scoped client either, so it does not need to
-- be reachable from a browser.
drop policy if exists "form_items_read_all" on public.form_items;
revoke all on public.form_items from anon, authenticated;

-- Validation records carry verifier reasoning, including derived key values.
revoke all on public.item_validations from anon, authenticated;

-- Rejected drafts hold full items with their keys.
revoke all on public.rejected_item_drafts from anon, authenticated;

notify pgrst, 'reload schema';
