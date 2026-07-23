-- ============================================================================
-- ExamPro — pg_cron database-level cutoff enforcement (PRD §4.1 / §8)
-- Auto-marks attempts whose fixed end time has passed, even if the Render
-- backend is down. Run AFTER schema.pg.sql in the SQL Editor.
--
-- Division of labor:
--   • This job guarantees SUBMISSION at the cutoff (status flip).
--   • The Render backend's 15-second sweep does full GRADING (it needs the
--     shuffle mapping + essay queue logic that lives in app code).
-- ============================================================================

create extension if not exists pg_cron;

-- Marks due attempts. Idempotent; safe to run every minute.
create or replace function exampro_mark_due_attempts()
returns integer
language plpgsql
as $$
declare
  affected integer;
begin
  update attempts
     set status = 'auto_submitted',
         submitted_at = now()
   where status = 'in_progress'
     and ends_at <= now();
  get diagnostics affected = row_count;
  return affected;
end;
$$;

-- Every minute (PRD calls for a periodic server-side check at the DB level).
select cron.schedule(
  'exampro-mark-due-attempts',
  '* * * * *',
  $$select exampro_mark_due_attempts()$$
);

-- Housekeeping: drop expired sessions nightly (keeps the token tables small).
select cron.schedule(
  'exampro-purge-expired-sessions',
  '17 3 * * *',
  $$delete from teacher_sessions where expires_at < now();
    delete from student_sessions where expires_at < now();$$
);

-- Verify jobs afterwards:  select * from cron.job;
