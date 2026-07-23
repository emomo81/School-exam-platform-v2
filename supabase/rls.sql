-- ============================================================================
-- ExamPro — Row Level Security (PRD §8: scope DB access to the custom JWT
-- claims issued by the Render custom-auth service).
--
-- Model:
--   • The Express API connects with the SERVICE ROLE key, which BYPASSES RLS —
--     app-level authorization (requireTeacher / requireStudent / roster checks)
--     stays the single source of truth. RLS here is defense-in-depth for any
--     direct client connection (e.g. Realtime subscriptions from the browser).
--   • Student sessions carry a JWT with custom claims:
--       { "student_id": 123, "exam_id": 45, "attempt_id": 678 }
--     Policies below expose ONLY the rows those claims entitle.
-- ============================================================================

-- Helper: read a claim from the JWT Supabase Realtime/PostgREST validated.
create or replace function exampro_claim(key text)
returns text
language sql stable
as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> key, '');
$$;

alter table attempts   enable row level security;
alter table answers    enable row level security;
alter table violations enable row level security;

-- Students: read their own attempt row only.
create policy student_read_own_attempt on attempts
  for select using (student_id = exampro_claim('student_id')::integer);

-- Students: read/update answers that belong to their attempt, while it is live.
-- (update only via the Render API in practice — this keeps direct-write risk at zero
--  because no insert/update policy is granted to the anon role below.)
create policy student_read_own_answers on answers
  for select using (
    attempt_id = coalesce(exampro_claim('attempt_id')::integer, -1)
  );

-- Students: violations of their own attempt (visible on the post-exam screen).
create policy student_read_own_violations on violations
  for select using (
    attempt_id in (select id from attempts
                   where student_id = exampro_claim('student_id')::integer)
  );

-- Teachers are intentionally NOT given direct-table policies: they go through
-- the API (service role). To let a teacher browser subscribe to Realtime for an
-- exam, the Render service can mint a teacher-scoped JWT; add a policy then:
--   create policy teacher_read_attempts on attempts for select
--     using (exam_id in (select id from exams where course_id in (
--       select course_id from courses where owner_id = exampro_claim('teacher_id')::integer
--       union select course_id from course_teachers where teacher_id = exampro_claim('teacher_id')::integer)));
