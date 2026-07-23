-- ============================================================================
-- ExamPro — Supabase Realtime (PRD §6.1 live monitoring analogue to the SSE
-- stream the app currently uses). Run AFTER schema.pg.sql.
-- The Vercel frontend can subscribe directly to these tables; the teacher
-- dashboard receives pushed updates as rows change — no WebSocket server.
-- ============================================================================

begin;

alter publication supabase_realtime add table attempts;
alter publication supabase_realtime add table violations;
alter publication supabase_realtime add table answers;

-- Change these two to FULL replica identity so UPDATE events include old values
-- (lets the dashboard diff status transitions client-side).
alter table attempts   replica identity full;
alter table violations replica identity full;

commit;

-- Client-side example (front-end, @supabase/supabase-js):
--   supabase.channel('exam-'+examId)
--     .on('postgres_changes', { event: '*', schema: 'public', table: 'violations',
--                               filter: 'attempt_id=in.(' + attemptIds + ')' }, handler)
--     .subscribe();
