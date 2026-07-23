# ExamPro — Secure. Fair. Transparent.

A complete digital examination platform built from the PRD: timed exams with a **server-enforced fixed end time**, roster-gated access, anti-cheating lockdown with a **3-strike escalation policy**, Gemini **AI question generation & AI essay grading** (mandatory teacher review), live proctoring dashboard, analytics, course roll-ups, and CSV/PDF exports.

## Running the app

The app is currently RUNNING at **http://localhost:4000** (API + built frontend served by one process).

To start it yourself from scratch:

```bash
cd exampro
npm run setup     # installs server + web dependencies
npm run seed      # creates (or resets) the seeded demo database
npm run build     # builds the React frontend (web/dist)
npm start         # serves API + frontend on http://localhost:4000
```

Development mode (hot reload): `npm run dev:server` + `npm run dev:web` (web on :5173, proxies /api → :4000).
Reset demo data anytime: `npm run seed`. Run the 49-assertion test suite: `cd server && node test-e2e.mjs`.

## Seeded accounts (the dashboard state from the mock)

| Role | Login |
|---|---|
| Instructor (John Doe) | `john.doe@exampro.edu` / `demo1234` |
| Co-teacher (BIO 103) | `mark.rivera@exampro.edu` / `demo1234` |
| TA (BIO 201) | `alice.chen@exampro.edu` / `demo1234` |
| Admin | `admin@exampro.edu` / `admin1234` |
| Student — live exam | roll `STU-1001` · access code `CARD-7291` (Cardiology Final Exam, LIVE now) |
| Student — released results | roll `STU-1121` · code `ANAT-1103` (score + right/wrong + course standing) |

The seed always anchors "now": one **live exam** (118/120 students online, violations streaming), a second live exam **ending soon**, an exam starting in 45 min, 24 upcoming exams, 8 courses (2 ending soon), 320 students, AI review queue (8 questions, 5 rubrics, 3 quality alerts, 24 pending essay scores), integrity donut + violation-type charts for the last 7 days.

## AI features (Gemini)

AI Studio works end-to-end but needs your key:

```bash
cp .env.example .env
# edit .env:  GEMINI_API_KEY=your-key-here   (optionally GEMINI_MODEL)
npm start
```

Without a key, AI endpoints return a clear `503` message instead of failing silently. Human-in-the-loop is enforced: AI-drafted questions land in the **review queue** (approve → target exam/bank), and AI essay scores stay **pending** until a teacher confirms or overrides (overrides are audit-logged with original AI score, final score, timestamp, teacher ID).

## What's implemented (per PRD)

- **Courses as first-class entities** — roster once (manual + CSV bulk), inherited by all exams; per-exam **roster override** for make-ups/guests; co-teachers & TAs (TA = monitor/grade, no structural changes); course-level results roll-up with per-student trends.
- **Fixed end-time timer (4.1)** — absolute end = start + duration for everyone; late entry just loses time; server computes remaining time on every request and a 15-second sweep auto-submits expired attempts even if the student is offline.
- **Randomization (4.2)** — shuffled question order, shuffled MCQ options, and question-bank mode drawing N random questions per student (distinct sets).
- **Backtracking prevention (4.3)** — per-exam toggle, enforced in navigation.
- **Lockdown / anti-cheating (4.7)** — fullscreen enforcement, tab/window-blur detection, back-button interception, right-click / dev-tools / PrintScreen / Ctrl+P / copy blocking (each logged), **name+timestamp watermark**, severity policies: 3-strike (default), warn-only, zero-tolerance. Browser limits (phone photos, OS screen capture) are disclosed in the lobby.
- **Grading (4.5/4.9)** — MCQ auto-grading with shuffle-index mapping; AI essay grading via Gemini (score + rationale, queued async); manual grading; override audit trail.
- **Access control (5.2)** — roll number + access code; roster check (course-level default, exam-level override); one active session per roll number.
- **Dashboards (6.x)** — teacher home (stats, live overview sparkline, AI review queue, course performance rings, activity feed, integrity donut, violation bars, calendar, quick actions); **live monitoring** (SSE-pushed student grid + violation feed + per-student drill-down); post-exam analytics (distribution, avg/median, pass/fail, per-question difficulty); student review (score + right/wrong only — correct answers never disclosed); course roll-ups.
- **Exports** — exam CSV/PDF, course roll-up CSV, per-student PDF report card.
- **Audit logs** — violations, overrides, roster changes, exports, AI approvals/rejections, auth events.

## Stack

- `server/` — Node 20 + Express 5 + better-sqlite3 (zero-config locally; schema is Postgres-portable for Supabase). Gemini called server-side only. SSE for live monitoring (Supabase Realtime analogue), 15s/60s background jobs (pg_cron analogue), local uploads dir (Storage analogue).
- `web/` — React 18 + Vite SPA (component structure maps 1:1 to a Next.js port for Vercel).

## Layout

```
exampro/
├─ server/src/
│  ├─ db/{schema.sql, index.js, seed.js}
│  ├─ lib/   (auth, access, grading, proctor, gemini, exporters, sse, util)
│  ├─ routes/ (auth, courses, exams, questions, student, monitoring, grading, ai, analytics, dashboard, exports, misc)
│  ├─ index.js
│  └─ test-e2e.mjs          # 49-assertion API test suite
├─ web/src/
│  ├─ Shell.jsx, App.jsx, api.js, ui.jsx, styles.css
│  ├─ pages/    (Dashboard, Courses, CourseDetail, Exams, ExamDetail, QuestionBank,
│  │              Monitoring, MonitorExam, Results, ExamAnalytics, Reports, AIStudio,
│  │              Settings, Integrations, AuditLogs, Students, Login)
│  └─ student/StudentApp.jsx (check-in → lobby → lockdown exam room → results)
└─ .env.example
```
