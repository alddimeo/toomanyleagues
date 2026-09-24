update public.dashboard_state
set data = data - 'browser'
where data ? 'browser';
