import { Router } from 'express';
import { q } from '../db/index.js';
import { requireTeacher } from '../lib/auth.js';
import { examAccess } from '../lib/access.js';
import { bad, examStatus, examEnd, fmtPct } from '../lib/util.js';
import { examSummaryStats, examQuestionStats, examResultsRows } from '../lib/exporters.js';

export const analyticsRouter = Router();
analyticsRouter.use(requireTeacher);

// Full exam analytics (PRD 6.2): distribution, avg/median, pass/fail, per-question difficulty.
analyticsRouter.get('/exams/:id/analytics', (req, res) => {
  const acc = examAccess(req.teacher, req.params.id);
  if (!acc) return bad(res, 'Exam not found', 404);
  const rows = examResultsRows(acc.exam.id);
  const finished = rows.filter((r) => r.status !== 'in_progress');
  const stats = examSummaryStats(acc.exam.id, acc.exam.pass_pct);

  // Score distribution in 10 percentage-point bins
  const bins = Array.from({ length: 10 }, () => 0);
  for (const r of finished) {
    const p = fmtPct(r.score || 0, r.max_score || 0);
    bins[Math.min(9, Math.floor(p / 10))]++;
  }

  const overrides = q.all(
    `SELECT go.*, t.name AS teacher_name FROM grading_overrides go
     JOIN answers an ON an.id = go.answer_id
     JOIN attempts a ON a.id = an.attempt_id
     JOIN teachers t ON t.id = go.teacher_id
     WHERE a.exam_id = ? ORDER BY go.id DESC LIMIT 50`, acc.exam.id
  );

  res.json({
    exam: {
      id: acc.exam.id, title: acc.exam.title, status: examStatus(acc.exam),
      start_at: acc.exam.start_at, ends_at: examEnd(acc.exam), pass_pct: acc.exam.pass_pct,
      results_released: !!acc.exam.results_released,
    },
    stats: { ...stats, roster: q.get(`SELECT COUNT(*) AS n FROM enrollments WHERE course_id = ?`, acc.exam.course_id).n },
    histogram: bins,
    questions: examQuestionStats(acc.exam.id),
    students: rows.map((r) => ({
      attempt_id: r.id, roll_no: r.roll_no, name: r.student_name, status: r.status,
      violations: r.vios, answered: r.answered_count,
      score: r.score, max_score: r.max_score,
      pct: r.status === 'in_progress' ? null : fmtPct(r.score || 0, r.max_score || 0),
    })),
    overrides,
  });
});
