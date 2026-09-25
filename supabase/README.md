# Supabase staging migration

Firebase remains the source of truth. These migrations are schema-only until the staging project is created and the backup verification passes.

Canonical term IDs use `AY<academic-year>_T<term-number>` (for example `AY2569_T1`). UI labels such as `1/2569` are presentation data only. Legacy Firebase keys are preserved in `legacy_term_key`, `legacy_user_id`, and `legacy_data` for audit and rollback.

The policies in `0001_initial_schema.sql` are staging policies only. They must be replaced with teacher/class/administrator-scoped policies before production cutover.
