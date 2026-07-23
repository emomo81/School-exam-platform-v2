import { Router } from 'express';
import { q } from '../db/index.js';
import { requireTeacher } from '../lib/auth.js';
import { examAccess, attemptAccess } from '../lib/access.js';
import { bad, examEnd, examStatus, VIOLATION_TYPES } from '../lib/util.js';
import { sseSubscribe } from '../lib/sse.js';

export const monitoringRouter = Router();
monitoringRouter.use(requireTeacher);

function monitorSnapshot(examId) {
  const exam = q.get(`SELECT e.*, c.code AS course_code, c.title AS course_title
                      FROM exams e JOIN courses c ON c.id = e.course_id WHERE e.id = ?`, examId);
  const totalQuestions = exam.question_source === 'bank' && exam.bank_id
    ? Math.min(exam.question_count || Infinity, q.get(`SELECT COUNT(*) AS n FROM questions WHERE bank_id = ?`, exam.bank_id).n)
    : q.get(`SELECT COUNT(*) AS n FROM questions WHERE exam_id = ?`, examId).n;

  const roster = exam.use_roster_override
    ? q.all(`SELECT st.* FROM exam_roster_overrides ero JOIN students st ON st.id = ero.student_id WHERE ero.exam_id = ?`, examId)
    : q.all(`SELECT st.* FROM enrollments en JOIN students st ON st.id = en.student_id WHERE en.course_id = ?`, exam.course_id);

  const attempts = q.all(
    `SELECT a.*, st.roll_no, st.name FROM attempts a JOIN students st ON st.id = a.student_id WHERE a.exam_id = ?`, examId
  );
  const byStudent = new Map(attempts.map((a) => [a.student_id, a]));

  const students = roster.map((st) => {
    const a = byStudent.get(st.id);
    const lastSeenMs = a?.last_seen ? Date.now() - Date.parse(a.last_seen) : null;
    const connected = a?.status === 'in_progress' && lastSeenMs != null && lastSeenMs < 45000;
    return {
      student_id: st.id, roll_no: st.roll_no, name: st.name,
      attempt_id: a?.id ?? null,
      status: a ? (a.status === 'in_progress' ? (connected ? 'active' : 'disconnected') : a.status) : 'not_started',
      answered: a?.answered_count ?? 0,
      violations: a?.violations_count ?? 0,
      remaining_ms: a?.status === 'in_progress' ? Math.max(0, Date.parse(a.ends_at) - Date.now()) : null,
      last_seen: a?.last_seen ?? null,
      score: a?.status !== 'in_progress' && a ? a.score : null,
      max_score: a?.max_score ?? null,
    };
  }).sort((x, y) => x.roll_no.localeCompare(y.roll_no));

  const feed = q.all(
    `SELECT v.*, st.roll_no, st.name, a.exam_id FROM violations v
     JOIN attempts a ON a.id = v.attempt_id JOIN students st ON st.id = a.student_id
     WHERE a.exam_id = ? ORDER BY v.id DESC LIMIT 30`, examId
  ).map((v) => ({ ...v, label: VIOLATION_TYPES[v.type] || v.type }));

  const counts = {
    roster: students.length,
    active: students.filter((s) => s.status === 'active').length,
    disconnected: students.filter((s) => s.status === 'disconnected').length,
    submitted: students.filter((s) => ['submitted', 'auto_submitted', 'terminated'].includes(s.status)).length,
    terminated: students.filter((s) => s.status === 'terminated').length,
    not_started: students.filter((s) => s.status === 'not_started').length,
    flagged: students.filter((s) => s.violations > 0).length,
  };
  return {
    exam: {
      id: exam.id, title: exam.title, course: `${exam.course_code} — ${exam.course_title}`,
      start_at: exam.start_at, ends_at: examEnd(exam), status: examStatus(exam),
      severity_policy: exam.severity_policy, total_questions: totalQuestions,
    },
    counts, students, feed, server_now: new Date().toISOString(),
  };
}

monitoringRouter.get('/exams/:id/monitor', (req, res) => {
  const acc = examAccess(req.teacher, req.params.id);
  if (!acc) return bad(res, 'Exam not found', 404);
  res.json(monitorSnapshot(acc.exam.id));
});

// Live stream (Supabase Realtime analogue) — client refetches the snapshot on any event.
monitoringRouter.get('/exams/:id/monitor/stream', (req, res) => {
  const acc = examAccess(req.teacher, req.params.id);
  if (!acc) return bad(res, 'Exam not found', 404);
  sseSubscribe(acc.exam.id, res);
});

// Teacher drill-down into a single attempt (PRD 6.1). Teachers see full detail,
// including correct answers (students do not).
monitoringRouter.get('/attempts/:id', (req, res) => {
  const acc = attemptAccess(req.teacher, req.params.id);
  if (!acc) return bad(res, 'Attempt not found', 404);
  const a = acc.attempt;
  const st = q.get(`SELECT * FROM students WHERE id = ?`, a.student_id);
  const order = JSON.parse(a.order_json || '[]');
  const items = order.map((o, i) => {
    const qu = q.get(`SELECT * FROM questions WHERE id = ?`, o.question_id);
    const an = q.get(`SELECT * FROM answers WHERE attempt_id = ? AND question_id = ?`, a.id, o.question_id);
    const options = qu.type === 'mcq' ? JSON.parse(qu.options_json || '[]') : null;
    return {
      position: i + 1, question_id: qu.id, type: qu.type, text: qu.text, points: qu.points,
      options,
      correct_index: qu.type === 'mcq' ? qu.correct_index : null,
      model_answer: qu.type === 'essay' ? qu.model_answer : null,
      selected_index: an?.selected_index ?? null,       // original-index space
      essay_text: an?.essay_text ?? null,
      is_correct: an?.is_correct ?? null,
      ai_score: an?.ai_score ?? null, ai_rationale: an?.ai_rationale ?? null,
      final_score: an?.final_score ?? null, grading_status: an?.grading_status ?? 'none',
    };
  });
  const violations = q.all(
    `SELECT * FROM violations WHERE attempt_id = ? ORDER BY id`, a.id
  ).map((v) => ({ ...v, label: VIOLATION_TYPES[v.type] || v.type }));
  res.json({
    attempt: a, student: { id: st.id, roll_no: st.roll_no, name: st.name },
    exam: { id: acc.exam.id, title: acc.exam.title },
    items, violations,
  });
});

export { monitorSnapshot };
