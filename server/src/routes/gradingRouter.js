import { Router } from 'express';
import { q, nowIso } from '../db/index.js';
import { requireTeacher } from '../lib/auth.js';
import { examAccess } from '../lib/access.js';
import { bad, audit } from '../lib/util.js';
import { recomputeScore, enqueueAiGrading } from '../lib/grading.js';

export const gradingRouter = Router();
gradingRouter.use(requireTeacher);

// Essay grading queue for an exam (PRD 4.5/4.9) — submitted attempts only.
gradingRouter.get('/exams/:id/grading', async (req, res) => {
  const acc = await examAccess(req.teacher, req.params.id);
  if (!acc) return bad(res, 'Exam not found', 404);
  const rows = await q.all(
    `SELECT an.id AS answer_id, an.attempt_id, an.essay_text, an.points_awarded,
            an.ai_score, an.ai_rationale, an.final_score, an.grading_status, an.graded_at,
            qu.id AS question_id, qu.text AS question_text, qu.points, qu.model_answer,
            st.roll_no, st.name AS student_name, t2.name AS grader_name
     FROM answers an
     JOIN attempts a ON a.id = an.attempt_id
     JOIN students st ON st.id = a.student_id
     JOIN questions qu ON qu.id = an.question_id
     LEFT JOIN teachers t2 ON t2.id = an.graded_by
     WHERE a.exam_id = ? AND qu.type = 'essay' AND a.status != 'in_progress'
     ORDER BY CASE an.grading_status
         WHEN 'ai_pending' THEN 0 WHEN 'confirmed' THEN 1 ELSE 2 END, an.id`,
    acc.exam.id
  );
  const byQ = {};
  for (const qu of await q.all(`SELECT id, text FROM questions WHERE exam_id = ? AND type = 'essay'`, acc.exam.id)) {
    byQ[qu.id] = qu.text;
  }
  res.json({
    exam: { id: acc.exam.id, title: acc.exam.title, ai_grading_enabled: !!acc.exam.ai_grading_enabled },
    pending: rows.filter((r) => r.final_score == null).length,
    rows,
  });
});

// Confirm or set a final essay score. If different from the AI suggestion, it is
// an OVERRIDE and is written to the audit trail (PRD 4.9 human-in-the-loop).
gradingRouter.post('/answers/:id/grade', async (req, res) => {
  const row = await q.get(
    `SELECT an.*, a.exam_id, a.id AS att_id FROM answers an JOIN attempts a ON a.id = an.attempt_id WHERE an.id = ?`,
    req.params.id
  );
  if (!row) return bad(res, 'Answer not found', 404);
  const acc = await examAccess(req.teacher, row.exam_id);
  if (!acc) return bad(res, 'Not permitted', 403);
  const score = Number(req.body?.score);
  const qu = await q.get(`SELECT * FROM questions WHERE id = ?`, row.question_id);
  if (!Number.isFinite(score) || score < 0 || score > qu.points) {
    return bad(res, `Score must be between 0 and ${qu.points}`);
  }
  const now = nowIso();
  const isOverride = row.ai_score != null && Math.abs(row.ai_score - score) > 1e-9;
  const txStatus = isOverride ? 'overridden' : 'confirmed';
  await q.run(
    `UPDATE answers SET final_score = ?, grading_status = ?, graded_by = ?, graded_at = ?, updated_at = ? WHERE id = ?`,
    score, txStatus, req.teacher.id, now, now, row.id
  );
  if (isOverride) {
    await q.run(
      `INSERT INTO grading_overrides (answer_id, ai_score, teacher_score, teacher_id, created_at) VALUES (?,?,?,?,?)`,
      row.id, row.ai_score, score, req.teacher.id, now
    );
    await audit('teacher', req.teacher.id, 'grade.override', 'answer', row.id,
      { ai_score: row.ai_score, teacher_score: score, attempt_id: row.att_id });
  } else {
    await audit('teacher', req.teacher.id, 'grade.confirmed', 'answer', row.id, { score, attempt_id: row.att_id });
  }
  await recomputeScore(row.att_id);
  res.json({ ok: true, status: txStatus });
});

// Re-run (or run) Gemini grading for all ungraded/pending essay answers of an exam.
gradingRouter.post('/exams/:id/ai-grade', async (req, res) => {
  const acc = await examAccess(req.teacher, req.params.id);
  if (!acc) return bad(res, 'Exam not found', 404);
  const rows = await q.all(
    `SELECT an.id, an.attempt_id FROM answers an
     JOIN attempts a ON a.id = an.attempt_id JOIN questions qu ON qu.id = an.question_id
     WHERE a.exam_id = ? AND qu.type = 'essay' AND a.status != 'in_progress'
       AND an.ai_score IS NULL
       AND an.grading_status NOT IN ('confirmed','overridden')
       AND an.essay_text IS NOT NULL AND TRIM(an.essay_text) <> ''`, acc.exam.id
  );
  if (!rows.length) return res.json({ queued: 0 });
  const byAttempt = new Map();
  for (const r of rows) {
    await q.run(`UPDATE answers SET grading_status = 'ai_pending', updated_at = ? WHERE id = ?`, nowIso(), r.id);
    if (!byAttempt.has(r.attempt_id)) byAttempt.set(r.attempt_id, []);
    byAttempt.get(r.attempt_id).push(r.id);
  }
  for (const [attemptId, ids] of byAttempt) enqueueAiGrading(attemptId, ids);
  await audit('teacher', req.teacher.id, 'ai.grading_requested', 'exam', acc.exam.id, { count: rows.length });
  res.json({ queued: rows.length });
});
