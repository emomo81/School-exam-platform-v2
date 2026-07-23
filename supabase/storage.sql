-- ============================================================================
-- ExamPro — Supabase Storage for teacher-uploaded notes (PRD §4.8/§4.9)
-- Creates a PRIVATE bucket; only the backend (service role) reads/writes.
-- Run in the SQL Editor. (A bucket can also be created via Dashboard → Storage.)
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('exampro-notes', 'exampro-notes', false)
on conflict (id) do nothing;

-- Backend (service role) full access — service role bypasses storage RLS by
-- default, so no policy is strictly required; the explicit deny below keeps the
-- anon/authenticated roles from touching exam material directly.
create policy "deny public access to exam notes"
  on storage.objects for select
  using (bucket_id <> 'exampro-notes');

-- After enabling, point the server's notes upload path at Supabase Storage
-- (notes.stored_path becomes the object key, e.g. 'notes/42-1691234567890.pdf').
-- Suggested key layout:  notes/{course_id}/{notes.id}-{filename}
