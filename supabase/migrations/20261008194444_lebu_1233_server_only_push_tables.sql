-- Lebu 1.23.3 — notification tables are server-only.
revoke all on table public.notification_state from anon, authenticated;
revoke all on table public.push_subscriptions from anon, authenticated;
grant select, insert, update, delete on table public.notification_state to service_role;
grant select, insert, update, delete on table public.push_subscriptions to service_role;
