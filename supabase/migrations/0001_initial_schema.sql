-- Staging schema for the Firebase -> Supabase migration.
-- Firebase remains the source of truth until verification and cutover.

create extension if not exists pgcrypto;

create table if not exists public.terms (
  term_id text primary key,
  display_label text not null,
  academic_year integer not null,
  term_no integer not null,
  status text not null default 'active',
  legacy_term_key text,
  legacy_data jsonb not null default '{}'::jsonb,
  created_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (academic_year, term_no)
);

create table if not exists public.app_users (
  user_id text primary key,
  username text,
  email text,
  role text,
  status text,
  legacy_data jsonb not null default '{}'::jsonb,
  created_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.auth_profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique,
  legacy_user_id text,
  email text,
  role text,
  status text,
  legacy_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.subjects (
  subject_code text not null,
  term_id text not null references public.terms(term_id),
  subject_name text,
  teacher text,
  status text,
  legacy_data jsonb not null default '{}'::jsonb,
  created_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (term_id, subject_code)
);

create table if not exists public.students (
  student_id text not null,
  term_id text not null references public.terms(term_id),
  student_no text,
  prefix text,
  first_name text,
  last_name text,
  level text,
  room text,
  status text,
  legacy_data jsonb not null default '{}'::jsonb,
  created_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (term_id, student_id)
);

create table if not exists public.teacher_classes (
  teacher_class_id text not null,
  term_id text not null references public.terms(term_id),
  teacher_id text,
  subject_code text,
  level text,
  room text,
  status text,
  legacy_data jsonb not null default '{}'::jsonb,
  created_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (term_id, teacher_class_id)
);

create table if not exists public.assignments (
  assignment_id text not null,
  term_id text not null references public.terms(term_id),
  teacher_class_id text,
  subject_code text,
  title text,
  assignment_type text,
  max_score numeric,
  due_date date,
  level text,
  room text,
  status text,
  legacy_data jsonb not null default '{}'::jsonb,
  created_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (term_id, assignment_id)
);

create table if not exists public.attendance (
  record_id text not null,
  term_id text not null references public.terms(term_id),
  student_id text,
  subject_code text,
  attendance_date date,
  status text,
  note text,
  recorder text,
  legacy_data jsonb not null default '{}'::jsonb,
  created_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (term_id, record_id)
);

create table if not exists public.scores (
  score_id text not null,
  term_id text not null references public.terms(term_id),
  assignment_id text,
  student_id text,
  subject_code text,
  score numeric,
  is_submitted boolean,
  legacy_data jsonb not null default '{}'::jsonb,
  created_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (term_id, score_id)
);

create table if not exists public.settings (
  setting_key text not null,
  term_id text,
  value jsonb,
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (setting_key, term_id)
);

create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  action text,
  target text,
  term_id text,
  user_id text,
  detail jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index if not exists idx_students_term_room on public.students(term_id, level, room);
create index if not exists idx_assignments_term_subject on public.assignments(term_id, subject_code);
create index if not exists idx_attendance_term_date on public.attendance(term_id, attendance_date);
create index if not exists idx_scores_term_assignment on public.scores(term_id, assignment_id);
create index if not exists idx_scores_term_student on public.scores(term_id, student_id);
create index if not exists idx_teacher_classes_term_teacher on public.teacher_classes(term_id, teacher_id);

alter table public.terms enable row level security;
alter table public.app_users enable row level security;
alter table public.auth_profiles enable row level security;
alter table public.subjects enable row level security;
alter table public.students enable row level security;
alter table public.teacher_classes enable row level security;
alter table public.assignments enable row level security;
alter table public.attendance enable row level security;
alter table public.scores enable row level security;
alter table public.settings enable row level security;
alter table public.audit_log enable row level security;

-- Staging-only policy. Replace with teacher/administrator scoped policies before cutover.
do $$
declare t text;
begin
  foreach t in array array['terms','app_users','auth_profiles','subjects','students','teacher_classes','assignments','attendance','scores','settings','audit_log'] loop
    execute format('create policy %I on public.%I for all to authenticated using (true) with check (true)', 'staging_authenticated_all_' || t, t);
  end loop;
end $$;
