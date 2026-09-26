-- Apply only after Supabase OAuth and browser CRUD acceptance pass.
-- Firebase is not referenced. This migration changes authorization only.

grant usage on schema public to authenticated;
grant select, insert, update, delete on table
  public.terms, public.students, public.subjects, public.teacher_classes,
  public.assignments, public.attendance, public.scores, public.app_users,
  public.auth_profiles, public.settings, public.audit_log
  to authenticated;

create or replace function public.is_active_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.app_users u
    where lower(coalesce(u.email, '')) = lower(coalesce(auth.jwt()->>'email', ''))
      and lower(coalesce(u.status, '')) not in ('inactive', 'disabled')
      and lower(coalesce(u.role, '')) in ('admin', 'teacher', 'attendance_assistant')
  );
$$;

revoke all on function public.is_active_staff() from public;
grant execute on function public.is_active_staff() to authenticated;

alter table public.app_users enable row level security;
drop policy if exists staging_authenticated_all_app_users on public.app_users;
create policy staff_read_own_app_users on public.app_users
  for select to authenticated
  using (
    lower(coalesce(email, '')) = lower(coalesce(auth.jwt()->>'email', ''))
    or lower(coalesce(auth.jwt()->>'email', '')) = 'suradet.t@wrk.ac.th'
  );
create policy admin_write_app_users on public.app_users
  for all to authenticated
  using (lower(coalesce(auth.jwt()->>'email', '')) = 'suradet.t@wrk.ac.th')
  with check (lower(coalesce(auth.jwt()->>'email', '')) = 'suradet.t@wrk.ac.th');

-- Application-layer scope checks remain in the bridge. These policies ensure
-- that only approved staff can reach the data API; anonymous users cannot.
do $$
declare
  t text;
begin
  foreach t in array array['terms','students','subjects','teacher_classes','assignments','attendance','scores','auth_profiles','settings','audit_log'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists staging_authenticated_all_%I on public.%I', t, t);
    execute format('create policy staff_select_%I on public.%I for select to authenticated using (public.is_active_staff())', t, t);
    execute format('create policy staff_insert_%I on public.%I for insert to authenticated with check (public.is_active_staff())', t, t);
    execute format('create policy staff_update_%I on public.%I for update to authenticated using (public.is_active_staff()) with check (public.is_active_staff())', t, t);
    execute format('create policy staff_delete_%I on public.%I for delete to authenticated using (public.is_active_staff())', t, t);
  end loop;
end $$;
