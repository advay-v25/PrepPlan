-- 20270102 revoked these tables from public roles but never granted the server role the app reads them with.
-- On the deployed project that made mock-report pages and the account export fail with "permission denied".
grant select, insert, update, delete on public.mock_reports, public.mock_report_commands to service_role;
