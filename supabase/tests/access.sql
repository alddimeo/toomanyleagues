-- Run after the migration in the Supabase SQL editor; leaves no data behind.
begin;
do $$
begin
  assert not has_table_privilege('anon', 'public.dashboard_state', 'select');
  assert not has_table_privilege('authenticated', 'public.dashboard_state', 'select');
  assert not has_table_privilege('authenticated', 'public.dashboard_state', 'insert');
  assert not has_table_privilege('authenticated', 'public.dashboard_state', 'update');
  assert not has_table_privilege('authenticated', 'public.dashboard_state', 'delete');
  assert not has_function_privilege('anon', 'public.lock_dashboard(uuid,uuid)', 'execute');
  assert not has_function_privilege('authenticated', 'public.lock_dashboard(uuid,uuid)', 'execute');
  assert has_function_privilege('service_role', 'public.lock_dashboard(uuid,uuid)', 'execute');
  assert (select relrowsecurity from pg_class where oid = 'public.dashboard_state'::regclass);
end $$;
rollback;
