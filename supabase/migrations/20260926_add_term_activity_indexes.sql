-- Performance support for the term-scoped compatibility reads.
-- Safe to apply after the RLS migration; no data or authorization changes.
create index if not exists idx_students_term_level_room
  on public.students (term_id, level, room);
create index if not exists idx_teacher_classes_term_teacher
  on public.teacher_classes (term_id, teacher_id);
create index if not exists idx_assignments_term_subject_class
  on public.assignments (term_id, subject_code, teacher_class_id);
create index if not exists idx_attendance_term_date_class
  on public.attendance (term_id, attendance_date, subject_code, level, room);
create index if not exists idx_scores_term_assignment_student
  on public.scores (term_id, assignment_id, student_id);
