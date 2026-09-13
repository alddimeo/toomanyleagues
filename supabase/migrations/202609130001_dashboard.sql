create table public.dashboard_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  lease_id uuid,
  lease_until timestamptz
);
alter table public.dashboard_state enable row level security;
revoke all on public.dashboard_state from anon, authenticated;
grant all on public.dashboard_state to service_role;

-- Backend-only table: browser clients cannot retrieve encrypted credentials or live-session handles.
create function public.lock_dashboard(owner_id uuid, lease_id uuid)
returns setof public.dashboard_state language sql set search_path = '' as $$
  update public.dashboard_state
  set lease_id = $2, lease_until = now() + interval '180 seconds'
  where user_id = $1 and (lease_until is null or lease_until < now())
  returning *;
$$;
revoke all on function public.lock_dashboard(uuid, uuid) from public, anon, authenticated;
grant execute on function public.lock_dashboard(uuid, uuid) to service_role;
