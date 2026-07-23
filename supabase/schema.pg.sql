-- ============================================================================
-- ExamPro — Postgres schema for Supabase (converted from the SQLite schema)
-- Run FIRST in: Supabase Dashboard → SQL Editor → New query → paste → Run
-- Idempotent: safe to re-run (IF NOT EXISTS everywhere).
-- ============================================================================

begin;

create table if not exists teachers (
  id            integer generated always as identity primary key,
  name          text not null,
  email         text unique not null,
  password_hash text not null,
  role          text not null default 'teacher',        -- 'admin' | 'teacher'
  prefs_json    text default '{}',
  activity_seen_at text,                                -- unread-badge watermark (notifications)
  ai_seen_at       text,                                -- unread-badge watermark (AI queue)
  created_at    timestamptz not null default now()
);

create table if not exists teacher_sessions (
  token      text primary key,
  teacher_id integer not null references teachers(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table if not exists courses (
  id         integer generated always as identity primary key,
  owner_id   integer not null references teachers(id),
  code       text not null,                              -- e.g. 'BIO 201'
  title      text not null,
  term       text not null,                              -- e.g. 'Fall 2026'
  term_end   text,
  color      text not null default '#16a34a',
  archived   integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists course_teachers (             -- co-teachers / TAs
  id         integer generated always as identity primary key,
  course_id  integer not null references courses(id) on delete cascade,
  teacher_id integer not null references teachers(id) on delete cascade,
  role       text not null default 'co-teacher',         -- 'co-teacher' | 'ta'
  created_at timestamptz not null default now(),
  unique(course_id, teacher_id)
);

create table if not exists students (
  id         integer generated always as identity primary key,
  roll_no    text unique not null,
  name       text not null,
  email      text,
  created_at timestamptz not null default now()
);

create table if not exists enrollments (                 -- course roster
  id         integer generated always as identity primary key,
  course_id  integer not null references courses(id) on delete cascade,
  student_id integer not null references students(id) on delete cascade,
  added_via  text not null default 'manual',             -- 'manual' | 'csv'
  created_at timestamptz not null default now(),
  unique(course_id, student_id)
);

create table if not exists question_banks (
  id         integer generated always as identity primary key,
  course_id  integer not null references courses(id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now()
);

create table if not exists exams (
  id                   integer generated always as identity primary key,
  course_id            integer not null references courses(id) on delete cascade,
  title                text not null,
  description          text default '',
  access_code          text unique not null,
  start_at             timestamptz not null,             -- fixed window start
  duration_min         integer not null,                 -- fixed absolute end = start_at + duration
  shuffle_questions    integer not null default 1,
  shuffle_options      integer not null default 1,
  allow_backtracking   integer not null default 1,
  question_source      text not null default 'custom',   -- 'custom' | 'bank'
  bank_id              integer references question_banks(id) on delete set null,
  question_count       integer,                          -- bank mode: draw N; custom mode NULL = all
  severity_policy      text not null default 'warn_limit', -- 'warn' | 'warn_limit' | 'zero_tolerance'
  ai_grading_enabled   integer not null default 0,
  use_roster_override  integer not null default 0,
  results_released     integer not null default 0,
  force_closed_at      timestamptz,
  pass_pct             integer not null default 50,
  created_by           integer references teachers(id),
  created_at           timestamptz not null default now()
);

create table if not exists questions (
  id            integer generated always as identity primary key,
  exam_id       integer references exams(id) on delete cascade,
  bank_id       integer references question_banks(id) on delete cascade,
  type          text not null,                           -- 'mcq' | 'essay'
  text          text not null,
  options_json  text,                                    -- JSON array of option strings (mcq)
  correct_index integer,                                 -- mcq
  points        integer not null default 1,
  model_answer  text,                                    -- essay
  source        text not null default 'manual',          -- 'manual' | 'ai'
  flagged       integer not null default 0,              -- quality alert
  created_at    timestamptz not null default now(),
  check (exam_id is not null or bank_id is not null)
);

create table if not exists exam_roster_overrides (       -- per-exam include-only roster
  id         integer generated always as identity primary key,
  exam_id    integer not null references exams(id) on delete cascade,
  student_id integer not null references students(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(exam_id, student_id)
);

create table if not exists notes (                        -- teacher reference notes
  id          integer generated always as identity primary key,
  course_id   integer not null references courses(id) on delete cascade,
  filename    text not null,
  stored_path text not null,                             -- local path now; Storage object key when migrated
  mime        text,
  chars       integer not null default 0,
  uploaded_by integer references teachers(id),
  created_at  timestamptz not null default now()
);

create table if not exists ai_generations (               -- AI review queue
  id          integer generated always as identity primary key,
  course_id   integer not null references courses(id) on delete cascade,
  exam_id     integer references exams(id) on delete set null,
  note_id     integer references notes(id) on delete set null,
  kind        text not null,                              -- 'mcq' | 'essay' | 'rubric'
  payload_json text not null,
  status      text not null default 'pending',            -- 'pending' | 'approved' | 'rejected'
  reviewed_by integer references teachers(id),
  reviewed_at timestamptz,
  created_at  timestamptz not null default now()
);

create table if not exists attempts (
  id               integer generated always as identity primary key,
  exam_id          integer not null references exams(id) on delete cascade,
  student_id       integer not null references students(id) on delete cascade,
  status           text not null default 'in_progress',   -- 'in_progress' | 'submitted' | 'auto_submitted' | 'terminated'
  started_at       timestamptz not null default now(),
  ends_at          timestamptz not null,                  -- fixed absolute end (server-side timer)
  submitted_at     timestamptz,
  order_json       text not null,                         -- [{question_id, options:[origIdx...]}]
  answered_count   integer not null default 0,
  score            double precision,
  max_score        double precision,
  violations_count integer not null default 0,
  last_seen        timestamptz,
  unique(exam_id, student_id)                             -- one attempt per exam per student
);

create table if not exists student_sessions (
  token       text primary key,
  student_id  integer not null references students(id) on delete cascade,
  exam_id     integer not null references exams(id) on delete cascade,
  attempt_id  integer references attempts(id) on delete cascade,
  active      integer not null default 1,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);

create table if not exists answers (
  id             integer generated always as identity primary key,
  attempt_id     integer not null references attempts(id) on delete cascade,
  question_id    integer not null references questions(id) on delete cascade,
  selected_index integer,                                 -- mcq (index in ORIGINAL order; mapped via order_json)
  essay_text     text,
  is_correct     integer,
  points_awarded double precision not null default 0,
  ai_score       double precision,                       -- Gemini suggestion (essay)
  ai_rationale   text,
  final_score    double precision,                       -- teacher-confirmed score
  grading_status text not null default 'none',           -- 'none' | 'auto' | 'ai_pending' | 'confirmed' | 'overridden'
  graded_by      integer references teachers(id),
  graded_at      timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique(attempt_id, question_id)
);

create table if not exists grading_overrides (            -- audit trail for AI score overrides
  id            integer generated always as identity primary key,
  answer_id     integer not null references answers(id) on delete cascade,
  ai_score      double precision,
  teacher_score double precision not null,
  teacher_id    integer not null references teachers(id),
  created_at    timestamptz not null default now()
);

create table if not exists violations (
  id         integer generated always as identity primary key,
  attempt_id integer not null references attempts(id) on delete cascade,
  type       text not null,     -- tab_blur | fullscreen_exit | back_nav | right_click | copy_paste | print_screen | devtools
  detail     text,
  strike     integer not null,
  created_at timestamptz not null default now()
);

create table if not exists presence_samples (             -- live-overview chart series
  id           integer generated always as identity primary key,
  ts           timestamptz not null default now(),
  online_count integer not null
);

create table if not exists audit_logs (
  id         integer generated always as identity primary key,
  actor_type text not null default 'teacher',             -- 'teacher' | 'student' | 'system'
  actor_id   integer,
  action     text not null,                               -- e.g. 'exam.created', 'grade.override'
  entity     text,
  entity_id  integer,
  meta_json  text default '{}',
  created_at timestamptz not null default now()
);

create index if not exists idx_attempts_exam      on attempts(exam_id);
create index if not exists idx_attempts_status    on attempts(status);
create index if not exists idx_answers_attempt    on answers(attempt_id);
create index if not exists idx_violations_attempt on violations(attempt_id);
create index if not exists idx_violations_created on violations(created_at);
create index if not exists idx_questions_exam     on questions(exam_id);
create index if not exists idx_enrollments_course on enrollments(course_id);
create index if not exists idx_exams_course       on exams(course_id);
create index if not exists idx_audit_created      on audit_logs(created_at);

commit;
