import { Router } from 'express';
import { q, nowIso } from '../db/index.js';
import { requireStudent, attachAttemptToStudentSession } from '../lib/auth.js';
import { bad, examEnd, examStatus, parseJson, fmtPct } from '../lib/util.js';
import { createAttempt, finalizeAttempt, buildPaper, savedAnswersFor, saveAnswers, getAttempt } from '../lib/grading.js';
import { recordViolation } from '../lib/proctor.js';
import { ssePublish } from '../lib/sse.js';

export const studentRouter = Router();
studentRouter.use(requireStudent);

function loadExam(req) {
  return q.get(`SELECT e.*, c.code AS course_code, c.title AS course_title, c.id AS cid
                FROM exams e JOIN courses c ON c.id = e.course_id WHERE e.id = ?`, req.student.examId);
}

// Hard server-side clock enforcement (PRD 4.1): any request arriving after the
// fixed end time finalizes the attempt instead of serving it.
function enforceClock(req, res) {
  const attempt = req.student.attemptId ? getAttempt(req.student.attemptId) : null;
  if (!attempt) return { attempt: null };
  if (attempt.status === 'in_progress' && Date.now() >= Date.parse(attempt.ends_at)) {
    finalizeAttempt(attempt.id, 'auto');
    return { attempt: getAttempt(attempt.id), expired: true };
  }
  return { attempt };
}

function attemptState(attempt) {
  if (!attempt) return null;
  return {
    id: attempt.id, status: attempt.status,
    started_at: attempt.started_at, ends_at: attempt.ends_at,
    submitted_at: attempt.submitted_at,
    answered_count: attempt.answered_count,
    violations_count: attempt.violations_count,
    remaining_ms: Math.max(0, Date.parse(attempt.ends_at) - Date.now()),
  };
}

studentRouter.get('/state', (req, res) => {
  const exam = loadExam(req);
  if (!exam) return bad(res, 'Exam not found', 404);
  const { attempt } = enforceClock(req, res);
  res.json({
    student: req.student,
    exam: {
      id: exam.id, title: exam.title, course: `${exam.course_code} — ${exam.course_title}`,
      start_at: exam.start_at, ends_at: examEnd(exam), status: examStatus(exam),
      allow_backtracking: !!exam.allow_backtracking, severity_policy: exam.severity_policy,
    },
    attempt: attemptState(attempt),
    results_released: !!exam.results_released,
    server_now: nowIso(),
  });
});

// Start (or resume) the attempt. One attempt per student per exam (PRD §10.2).
studentRouter.post('/start', (req, res) => {
  const exam = loadExam(req);
  if (!exam) return bad(res, 'Exam not found', 404);
  const status = examStatus(exam);
  const now = Date.now();
  if (now < Date.parse(exam.start_at)) return bad(res, 'The exam has not started yet.', 409);
  if (exam.force_closed_at || now >= Date.parse(examEnd(exam))) return bad(res, 'The exam window has closed.', 409);

  let attempt = req.student.attemptId ? getAttempt(req.student.attemptId) : null;
  if (!attempt) attempt = q.get(`SELECT * FROM attempts WHERE exam_id = ? AND student_id = ?`, exam.id, req.student.id);
  if (attempt && attempt.status !== 'in_progress') {
    return bad(res, 'You have already submitted this exam.', 409);
  }
  if (!attempt) {
    try {
      attempt = createAttempt(exam, req.student.id);
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) {
        attempt = q.get(`SELECT * FROM attempts WHERE exam_id = ? AND student_id = ?`, exam.id, req.student.id);
      } else throw e;
    }
  }
  attachAttemptToStudentSession(req.student.token, attempt.id);
  ssePublish(exam.id, 'attempt', { type: 'attempt', attemptId: attempt.id, status: 'in_progress' });
  res.json({
    attempt: attemptState(attempt),
    paper: buildPaper(attempt),
    saved: savedAnswersFor(attempt.id),
    server_now: nowIso(),
  });
});

studentRouter.get('/paper', (req, res) => {
  const { attempt, expired } = enforceClock(req, res);
  if (!attempt) return bad(res, 'No attempt — start the exam first', 409);
  if (attempt.status !== 'in_progress') {
    return res.json({ attempt: attemptState(attempt), expired: true });
  }
  res.json({ attempt: attemptState(attempt), paper: buildPaper(attempt), saved: savedAnswersFor(attempt.id), server_now: nowIso() });
});

// Answer autosave (batched). Displayed option indices are converted server-side.
studentRouter.post('/sync', (req, res) => {
  const { attempt, expired } = enforceClock(req, res);
  if (!attempt || attempt.status !== 'in_progress') {
    return res.status(409).json({ expired: true, attempt: attemptState(attempt) });
  }
  saveAnswers(attempt, req.body?.answers || []);
  const fresh = getAttempt(attempt.id);
  ssePublish(attempt.exam_id, 'progress', { type: 'progress', attemptId: attempt.id });
  res.json({ attempt: attemptState(fresh), server_now: nowIso() });
});

studentRouter.post('/heartbeat', (req, res) => {
  const { attempt, expired } = enforceClock(req, res);
  if (!attempt) return res.status(409).json({ expired: true });
  if (attempt.status === 'in_progress') {
    q.run(`UPDATE attempts SET last_seen = ? WHERE id = ?`, nowIso(), attempt.id);
  }
  res.json({ attempt: attemptState(getAttempt(attempt.id)), server_now: nowIso(), expired: !!expired });
});

// Violation reporting from the lockdown client (PRD 4.7).
studentRouter.post('/violation', (req, res) => {
  const attempt = req.student.attemptId ? getAttempt(req.student.attemptId) : null;
  if (!attempt || attempt.status !== 'in_progress') {
    return res.json({ ignored: true, attempt: attemptState(attempt) });
  }
  const result = recordViolation(attempt, req.body?.type, req.body?.detail);
  res.json({ ...result, attempt: attemptState(getAttempt(attempt.id)) });
});

studentRouter.post('/submit', (req, res) => {
  const attempt = req.student.attemptId ? getAttempt(req.student.attemptId) : null;
  if (!attempt) return bad(res, 'No attempt', 409);
  if (attempt.status === 'in_progress' && Array.isArray(req.body?.answers)) {
    saveAnswers(attempt, req.body.answers);
  }
  const final = attempt.status === 'in_progress' ? finalizeAttempt(attempt.id, 'submitted') : attempt;
  res.json({ attempt: attemptState(final) });
});

// Post-exam review (PRD 6.3): score + right/wrong per question only — correct
// answers and explanations are NOT exposed (question-bank reuse is safe).
studentRouter.get('/results', (req, res) => {
  const exam = loadExam(req);
  if (!exam) return bad(res, 'Exam not found', 404);
  const attempt = q.get(`SELECT * FROM attempts WHERE exam_id = ? AND student_id = ?`, exam.id, req.student.id);
  if (!attempt) return bad(res, 'No attempt for this exam', 404);
  if (!exam.results_released) {
    return res.json({ released: false, attempt: attemptState(attempt), exam: { title: exam.title } });
  }
  const order = parseJson(attempt.order_json, []);
  const obj = { score: 0, max: 0, correct: 0, total: 0, answered: 0 };
  const essay = { count: 0, graded: 0, pending: 0, score: 0, max: 0 };
  const items = order.map((o, i) => {
    const qu = q.get(`SELECT * FROM questions WHERE id = ?`, o.question_id);
    const an = q.get(`SELECT * FROM answers WHERE attempt_id = ? AND question_id = ?`, attempt.id, o.question_id);
    const base = { position: i + 1, type: qu.type, points: qu.points, correct: null, score: null, status: 'unanswered' };
    if (qu.type === 'mcq') {
      obj.total++; obj.max += qu.points;
      if (an?.selected_index != null) {
        obj.answered++;
        base.status = an.is_correct ? 'correct' : 'wrong';
        base.correct = !!an.is_correct;
        if (an.is_correct) { obj.correct++; obj.score += qu.points; }
      }
    } else {
      essay.count++; essay.max += qu.points;
      base.status = an?.essay_text?.trim() ? 'answered' : 'unanswered';
      base.graded = an?.final_score != null;
      if (an?.final_score != null) { essay.graded++; essay.score += an.final_score; base.score = an.final_score; }
      else essay.pending++;
    }
    return base;
  });
  // MCQ-only exams are fully machine-marked at submit (complete as soon as
  // released). Mixed exams show a PROVISIONAL result: objective marks now,
  // essay marks once the teacher confirms them.
  essay.score = Math.round(essay.score * 10) / 10;
  const complete = essay.pending === 0;
  const pct = attempt.max_score ? fmtPct(attempt.score || 0, attempt.max_score) : 0;
  const objPct = obj.max ? fmtPct(obj.score, obj.max) : null;

  // Course-level cumulative standing (PRD 6.4, student view): own released results
  const courseExams = q.all(
    `SELECT e.id, e.title, e.start_at, e.results_released FROM exams e
     WHERE e.course_id = ? ORDER BY e.start_at`, exam.course_id
  );
  const cumulative = courseExams.map((e) => {
    const a = q.get(`SELECT * FROM attempts WHERE exam_id = ? AND student_id = ?`, e.id, req.student.id);
    if (!a || !e.results_released || !a.max_score || a.status === 'in_progress') return null;
    return { exam_id: e.id, title: e.title, pct: fmtPct(a.score || 0, a.max_score), score: a.score, max: a.max_score };
  }).filter(Boolean);

  res.json({
    released: true,
    exam: { id: exam.id, title: exam.title, course: `${exam.course_code} — ${exam.course_title}`, pass_pct: exam.pass_pct },
    attempt: { ...attemptState(attempt), score: attempt.score, max_score: attempt.max_score },
    pct,
    // Objective vs essay split (per user requirement): students always see
    // their MCQ marks; essay marks arrive as teachers confirm them.
    objective: { ...obj, pct: objPct },
    essay,
    complete,                 // false → provisional (essays still being graded)
    pass: complete ? pct >= exam.pass_pct : null,
    items,
    cumulative,
    violations_count: attempt.violations_count,
  });
});
