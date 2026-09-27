-- Allow an authenticated staff member to update only their own profile row.
-- Role, email, and active status remain constrained by the policy.
begin;

drop policy if exists staff_update_own_teacher_profile on public.app_users;
create policy staff_update_own_teacher_profile on public.app_users
  for update to authenticated
  using (
    lower(coalesce(email, '')) = lower(coalesce(auth.jwt()->>'email', ''))
    and lower(coalesce(role, '')) = 'teacher'
  )
  with check (
    lower(coalesce(email, '')) = lower(coalesce(auth.jwt()->>'email', ''))
    and lower(coalesce(role, '')) = 'teacher'
    and lower(coalesce(status, '')) not in ('inactive', 'disabled')
  );

drop policy if exists staff_update_own_assistant_profile on public.app_users;
create policy staff_update_own_assistant_profile on public.app_users
  for update to authenticated
  using (
    lower(coalesce(email, '')) = lower(coalesce(auth.jwt()->>'email', ''))
    and lower(coalesce(role, '')) = 'attendance_assistant'
  )
  with check (
    lower(coalesce(email, '')) = lower(coalesce(auth.jwt()->>'email', ''))
    and lower(coalesce(role, '')) = 'attendance_assistant'
    and lower(coalesce(status, '')) not in ('inactive', 'disabled')
  );

commit;
