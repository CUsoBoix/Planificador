-- Access is limited to the GitHub account CUsoBoix (stable GitHub user ID 183085251).
create or replace function public.is_allowed_github_user()
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

revoke all on function public.is_allowed_github_user() from public, anon;
grant execute on function public.is_allowed_github_user() to authenticated;

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
  and (select public.is_allowed_github_user())
)
with check (
  user_id = (select auth.uid())
  and (select public.is_allowed_github_user())
);
