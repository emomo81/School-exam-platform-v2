-- ExamPro schema (SQLite dialect; Postgres-portable — DATETIME stored as ISO-8601 text)
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS teachers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'teacher',        -- 'admin' | 'teacher'
  prefs_json    TEXT DEFAULT '{}',
  activity_seen_at TEXT,                                -- last time notifications panel was opened (unread badge)
  ai_seen_at       TEXT,                                -- last time AI review queue was opened (unread badge)
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS teacher_sessions (
  token      TEXT PRIMARY KEY,
  teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS courses (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id   INTEGER NOT NULL REFERENCES teachers(id),
  code       TEXT NOT NULL,                              -- e.g. 'BIO 201'
  title      TEXT NOT NULL,                              -- e.g. 'Human Physiology'
  term       TEXT NOT NULL,                              -- e.g. 'Fall 2026'
  term_end   TEXT,                                       -- ISO date; "ending soon"
  color      TEXT NOT NULL DEFAULT '#16a34a',
  archived   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS course_teachers (             -- co-teachers / TAs
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id  INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'co-teacher',         -- 'co-teacher' | 'ta'
  created_at TEXT NOT NULL,
  UNIQUE(course_id, teacher_id)
);

CREATE TABLE IF NOT EXISTS students (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  roll_no    TEXT UNIQUE NOT NULL,
  name       TEXT NOT NULL,
  email      TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS enrollments (                 -- course roster
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id  INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  added_via  TEXT NOT NULL DEFAULT 'manual',             -- 'manual' | 'csv'
  created_at TEXT NOT NULL,
  UNIQUE(course_id, student_id)
);

CREATE TABLE IF NOT EXISTS question_banks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id  INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS exams (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id            INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title                TEXT NOT NULL,
  description          TEXT DEFAULT '',
  access_code          TEXT UNIQUE NOT NULL,
  start_at             TEXT NOT NULL,                    -- ISO; fixed window start
  duration_min         INTEGER NOT NULL,                 -- fixed absolute end = start_at + duration
  shuffle_questions    INTEGER NOT NULL DEFAULT 1,
  shuffle_options      INTEGER NOT NULL DEFAULT 1,
  allow_backtracking   INTEGER NOT NULL DEFAULT 1,
  question_source      TEXT NOT NULL DEFAULT 'custom',   -- 'custom' | 'bank'
  bank_id              INTEGER REFERENCES question_banks(id) ON DELETE SET NULL,
  question_count       INTEGER,                          -- bank mode: draw N; custom mode NULL = all
  severity_policy      TEXT NOT NULL DEFAULT 'warn_limit', -- 'warn' | 'warn_limit' | 'zero_tolerance'
  ai_grading_enabled   INTEGER NOT NULL DEFAULT 0,
  use_roster_override  INTEGER NOT NULL DEFAULT 0,
  results_released     INTEGER NOT NULL DEFAULT 0,
  force_closed_at      TEXT,
  pass_pct             INTEGER NOT NULL DEFAULT 50,
  created_by           INTEGER REFERENCES teachers(id),
  created_at           TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS questions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_id       INTEGER REFERENCES exams(id) ON DELETE CASCADE,
  bank_id       INTEGER REFERENCES question_banks(id) ON DELETE CASCADE,
  type          TEXT NOT NULL,                           -- 'mcq' | 'essay'
  text          TEXT NOT NULL,
  options_json  TEXT,                                    -- JSON array of option strings (mcq)
  correct_index INTEGER,                                 -- mcq
  points        INTEGER NOT NULL DEFAULT 1,
  model_answer  TEXT,                                    -- essay
  source        TEXT NOT NULL DEFAULT 'manual',          -- 'manual' | 'ai'
  flagged       INTEGER NOT NULL DEFAULT 0,              -- quality alert
  created_at    TEXT NOT NULL,
  CHECK (exam_id IS NOT NULL OR bank_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS exam_roster_overrides (       -- per-exam roster override (include-only list)
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_id    INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  UNIQUE(exam_id, student_id)
);

CREATE TABLE IF NOT EXISTS notes (                        -- teacher-uploaded reference notes
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id   INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  filename    TEXT NOT NULL,
  stored_path TEXT NOT NULL,
  mime        TEXT,
  chars       INTEGER NOT NULL DEFAULT 0,
  uploaded_by INTEGER REFERENCES teachers(id),
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_generations (               -- AI review queue (questions/rubrics)
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id   INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  exam_id     INTEGER REFERENCES exams(id) ON DELETE SET NULL,
  note_id     INTEGER REFERENCES notes(id) ON DELETE SET NULL,
  kind        TEXT NOT NULL,                              -- 'mcq' | 'essay' | 'rubric'
  payload_json TEXT NOT NULL,                             -- question or rubric payload
  status      TEXT NOT NULL DEFAULT 'pending',            -- 'pending' | 'approved' | 'rejected'
  reviewed_by INTEGER REFERENCES teachers(id),
  reviewed_at TEXT,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attempts (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_id          INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  student_id       INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  status           TEXT NOT NULL DEFAULT 'in_progress',   -- 'in_progress' | 'submitted' | 'auto_submitted' | 'terminated'
  started_at       TEXT NOT NULL,
  ends_at          TEXT NOT NULL,                         -- fixed absolute end copied at start (server-side timer)
  submitted_at     TEXT,
  order_json       TEXT NOT NULL,                         -- [{question_id, options:[origIdx...]}]
  answered_count   INTEGER NOT NULL DEFAULT 0,
  score            REAL,
  max_score        REAL,
  violations_count INTEGER NOT NULL DEFAULT 0,
  last_seen        TEXT,
  UNIQUE(exam_id, student_id)                             -- one attempt per exam per student
);

CREATE TABLE IF NOT EXISTS student_sessions (
  token       TEXT PRIMARY KEY,
  student_id  INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  exam_id     INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  attempt_id  INTEGER REFERENCES attempts(id) ON DELETE CASCADE,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS answers (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id     INTEGER NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  question_id    INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  selected_index INTEGER,                                 -- mcq (index in displayed order)
  essay_text     TEXT,
  is_correct     INTEGER,
  points_awarded REAL NOT NULL DEFAULT 0,               -- mcq auto-grade
  ai_score       REAL,                                   -- Gemini suggestion (essay)
  ai_rationale   TEXT,
  final_score    REAL,                                   -- teacher-confirmed score
  grading_status TEXT NOT NULL DEFAULT 'none',           -- 'none' | 'auto' | 'ai_pending' | 'confirmed' | 'overridden'
  graded_by      INTEGER REFERENCES teachers(id),
  graded_at      TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  UNIQUE(attempt_id, question_id)
);

CREATE TABLE IF NOT EXISTS grading_overrides (            -- audit trail for AI score overrides
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  answer_id     INTEGER NOT NULL REFERENCES answers(id) ON DELETE CASCADE,
  ai_score      REAL,
  teacher_score REAL NOT NULL,
  teacher_id    INTEGER NOT NULL REFERENCES teachers(id),
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS violations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id INTEGER NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,     -- tab_blur | fullscreen_exit | back_nav | right_click | copy_paste | print_screen | devtools
  detail     TEXT,
  strike     INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS presence_samples (             -- live-overview chart series
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ts            TEXT NOT NULL,
  online_count  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_type TEXT NOT NULL DEFAULT 'teacher',             -- 'teacher' | 'student' | 'system'
  actor_id   INTEGER,
  action     TEXT NOT NULL,                               -- e.g. 'exam.created', 'grade.override'
  entity     TEXT,
  entity_id  INTEGER,
  meta_json  TEXT DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_attempts_exam      ON attempts(exam_id);
CREATE INDEX IF NOT EXISTS idx_attempts_status    ON attempts(status);
CREATE INDEX IF NOT EXISTS idx_answers_attempt    ON answers(attempt_id);
CREATE INDEX IF NOT EXISTS idx_violations_attempt ON violations(attempt_id);
CREATE INDEX IF NOT EXISTS idx_violations_created ON violations(created_at);
CREATE INDEX IF NOT EXISTS idx_questions_exam     ON questions(exam_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_course ON enrollments(course_id);
CREATE INDEX IF NOT EXISTS idx_exams_course       ON exams(course_id);
CREATE INDEX IF NOT EXISTS idx_audit_created      ON audit_logs(created_at);
