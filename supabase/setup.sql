-- Access is limited to the GitHub account CUsoBoix (stable GitHub user ID 183085251).
create schema if not exists planner_private;
revoke all on schema planner_private from public, anon;
grant usage on schema planner_private to authenticated;

create or replace function planner_private.is_allowed_github_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.identities
    where user_id = (select auth.uid())
      and provider = 'github'
      and provider_id = '183085251'
  );
$$;

revoke all on function planner_private.is_allowed_github_user() from public, anon;
grant execute on function planner_private.is_allowed_github_user() to authenticated;

create table if not exists public.planner_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  tasks jsonb not null default '[]'::jsonb
    check (jsonb_typeof(tasks) = 'array'),
  meeting_calendar jsonb not null default '{"imported": false, "meetings": []}'::jsonb
    check (
      jsonb_typeof(meeting_calendar) = 'object'
      and meeting_calendar ? 'imported'
      and meeting_calendar ? 'meetings'
      and jsonb_typeof(meeting_calendar -> 'imported') = 'boolean'
      and jsonb_typeof(meeting_calendar -> 'meetings') = 'array'
    ),
  updated_at timestamptz not null default now()
);

alter table public.planner_state enable row level security;
revoke all on table public.planner_state from anon, authenticated;
grant select, insert, update on table public.planner_state to authenticated;

drop policy if exists "CUsoBoix can access planner state" on public.planner_state;
create policy "CUsoBoix can access planner state"
on public.planner_state
for all
to authenticated
using (
  user_id = (select auth.uid())
  and (select planner_private.is_allowed_github_user())
)
with check (
  user_id = (select auth.uid())
  and (select planner_private.is_allowed_github_user())
);

drop function if exists public.is_allowed_github_user();

-- Atomic compare-and-save prevents one device overwriting a newer snapshot.
create or replace function public.save_planner_state(
  p_tasks jsonb,
  p_meeting_calendar jsonb,
  p_expected_updated_at timestamptz
)
returns timestamptz
language plpgsql
security invoker
set search_path = ''
as $$
declare
  result_updated_at timestamptz;
begin
  insert into public.planner_state as current_row (
    user_id,
    tasks,
    meeting_calendar,
    updated_at
  )
  values (
    (select auth.uid()),
    p_tasks,
    p_meeting_calendar,
    clock_timestamp()
  )
  on conflict (user_id) do update
    set tasks = excluded.tasks,
        meeting_calendar = excluded.meeting_calendar,
        updated_at = clock_timestamp()
    where current_row.updated_at is not distinct from p_expected_updated_at
  returning current_row.updated_at into result_updated_at;

  return result_updated_at;
end;
$$;

revoke all on function public.save_planner_state(jsonb, jsonb, timestamptz) from public, anon;
grant execute on function public.save_planner_state(jsonb, jsonb, timestamptz) to authenticated;

notify pgrst, 'reload schema';
