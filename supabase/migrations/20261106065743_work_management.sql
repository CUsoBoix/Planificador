-- Additive upgrade. Run after setup.sql. The legacy ICS column and RPC remain intact.
begin;
alter table public.planner_state add column if not exists work_state jsonb not null default '{}'::jsonb;
create or replace function planner_private.valid_work_state(p_state jsonb) returns boolean
language plpgsql immutable security invoker set search_path = '' as $$
declare collection text; item jsonb;
begin
  if jsonb_typeof(p_state) <> 'object' or octet_length(p_state::text)>15000000 then return false; end if;
  foreach collection in array array['projects','sessions','proposals','recurrences','history'] loop
    if p_state ? collection then
      if jsonb_typeof(p_state->collection)<>'array' then return false; end if;
      if exists(select 1 from jsonb_array_elements(p_state->collection) x where jsonb_typeof(x)<>'object' or coalesce(x->>'id','')='') then return false; end if;
      if (select count(*)<>count(distinct x->>'id') from jsonb_array_elements(p_state->collection) x) then return false; end if;
    end if;
  end loop;
  for item in select * from jsonb_array_elements(coalesce(p_state->'sessions','[]'::jsonb)) loop
    if coalesce(item->>'start','')='' or coalesce(item->>'end','')='' then return false; end if;
    if coalesce(item->>'status','') not in ('proposed','accepted','running','paused','done','cancelled') then return false; end if;
    if (item->>'start')::timestamptz >= (item->>'end')::timestamptz then return false; end if;
  end loop;
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_state->'sessions','[]'::jsonb)) a
    join jsonb_array_elements(coalesce(p_state->'sessions','[]'::jsonb)) b on a->>'id'<b->>'id'
    where a->>'status' in ('accepted','running','paused') and b->>'status' in ('accepted','running','paused')
    and (a->>'start')::timestamptz < (b->>'end')::timestamptz
    and (b->>'start')::timestamptz < (a->>'end')::timestamptz
  ) then return false; end if;
  return true;
exception when others then return false;
end; $$;
revoke all on function planner_private.valid_work_state(jsonb) from public, anon;
grant execute on function planner_private.valid_work_state(jsonb) to authenticated;
alter table public.planner_state drop constraint if exists planner_work_state_valid;
alter table public.planner_state add constraint planner_work_state_valid check(planner_private.valid_work_state(work_state));

create or replace function public.save_planner_state_v2(p_tasks jsonb,p_meeting_calendar jsonb,p_work_state jsonb,p_expected_updated_at timestamptz)
returns timestamptz language plpgsql security invoker set search_path = '' as $$
declare result_updated_at timestamptz;
begin
  if jsonb_typeof(p_tasks)<>'array' or octet_length(p_tasks::text)>15000000 then raise exception 'Formato o tamaño de tareas no válido'; end if;
  if exists(select 1 from jsonb_array_elements(p_tasks) t where jsonb_typeof(t)<>'object' or coalesce(t->>'id','')='' or coalesce(t->>'text','')='' or jsonb_typeof(t->'completed') is distinct from 'boolean') then raise exception 'Tarea no válida'; end if;
  if (select count(*)<>count(distinct t->>'id') from jsonb_array_elements(p_tasks) t) then raise exception 'Identificadores de tarea duplicados'; end if;
  if exists(select 1 from jsonb_array_elements(coalesce(p_work_state->'sessions','[]'::jsonb)) s where coalesce(s->>'taskId','')<>'' and not exists(select 1 from jsonb_array_elements(p_tasks) t where t->>'id'=s->>'taskId')) then raise exception 'Sesión sin tarea'; end if;
  insert into public.planner_state as current_row(user_id,tasks,meeting_calendar,work_state,updated_at)
  values ((select auth.uid()),p_tasks,p_meeting_calendar,p_work_state,clock_timestamp())
  on conflict(user_id) do update set tasks=excluded.tasks,meeting_calendar=excluded.meeting_calendar,work_state=excluded.work_state,updated_at=clock_timestamp()
  where current_row.updated_at is not distinct from p_expected_updated_at
  returning updated_at into result_updated_at;
  return result_updated_at;
end; $$;
revoke all on function public.save_planner_state_v2(jsonb,jsonb,jsonb,timestamptz) from public,anon;
grant execute on function public.save_planner_state_v2(jsonb,jsonb,jsonb,timestamptz) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('planner-files','planner-files',false,52428800,array['application/pdf','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.presentationml.presentation','application/vnd.ms-excel','application/msword','application/vnd.ms-powerpoint','text/plain','text/csv','image/png','image/jpeg'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists "planner files owner read" on storage.objects;
create policy "planner files owner read" on storage.objects for select to authenticated
using(bucket_id='planner-files' and (storage.foldername(name))[1]=(select auth.uid())::text and (select planner_private.is_allowed_github_user()));
drop policy if exists "planner files owner insert" on storage.objects;
-- Uploads go through planner-upload for server-side content validation.
drop policy if exists "planner files owner delete" on storage.objects;
create policy "planner files owner delete" on storage.objects for delete to authenticated
using(bucket_id='planner-files' and (storage.foldername(name))[1]=(select auth.uid())::text and (select planner_private.is_allowed_github_user()));
notify pgrst,'reload schema';
commit;
