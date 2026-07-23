import { Router } from 'express';
import { q, nowIso } from '../db/index.js';
import { requireTeacher } from '../lib/auth.js';
import { canAccessCourse, examAccess, bankAccess, questionAccess, requireNonTa } from '../lib/access.js';
import { audit, bad } from '../lib/util.js';

export const questionsRouter = Router();
questionsRouter.use(requireTeacher);

function validateQuestion(body) {
  const { type, text, options, correct_index} = body || {};
  if (!['mcq', 'essay'].includes(type)) return 'type must be mcq or essay';
  if (!text || !String(text).trim()) return 'Question text is required';
  if (type === 'mcq') {
    if (!Array.isArray(options) || options.length < 2 || options.length > 6) return 'MCQ needs 2–6 options';
    if (options.some((o) => !String(o).trim())) return 'Options cannot be empty';
    if (!Number.isInteger(correct_index) || correct_index < 0 || correct_index >= options.length) return 'correct_index out of range';
  }
  return null;
}

async function questionLockedForExam(examId) {
  return (await q.get(`SELECT COUNT(*) AS n FROM attempts WHERE exam_id = ?`, examId)).n > 0;
}

// ------------------------------ Exam questions ------------------------------
questionsRouter.get('/exams/:examId/questions', async (req, res) => {
  const acc = await examAccess(req.teacher, req.params.examId);
  if (!acc) return bad(res, 'Exam not found', 404);
  const rows = acc.exam.question_source === 'bank' && acc.exam.bank_id
    ? await q.all(`SELECT * FROM questions WHERE bank_id = ? ORDER BY id`, acc.exam.bank_id)
    : await q.all(`SELECT * FROM questions WHERE exam_id = ? ORDER BY id`, acc.exam.id);
  const locked = await questionLockedForExam(acc.exam.id);
  res.json(rows.map((r) => ({ ...r, options: r.options_json ? JSON.parse(r.options_json) : null, locked })));
});

questionsRouter.post('/exams/:examId/questions', async (req, res) => {
  const acc = await examAccess(req.teacher, req.params.examId);
  if (!acc) return bad(res, 'Exam not found', 404);
  if (!requireNonTa(acc.role)) return bad(res, 'Not permitted', 403);
  if (await questionLockedForExam(acc.exam.id)) return bad(res, 'Questions are locked — students have already started this exam.', 409);
  const err = validateQuestion(req.body);
  if (err) return bad(res, err);
  const { type, text, options, correct_index, points, model_answer } = req.body;
  const info = await q.run(
    `INSERT INTO questions (exam_id, type, text, options_json, correct_index, points, model_answer, source, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    acc.exam.id, type, String(text).trim(),
    type === 'mcq' ? JSON.stringify(options.map((o) => String(o).trim())) : null,
    type === 'mcq' ? correct_index : null,
    Math.max(0.5, Number(points) || 1), type === 'essay' ? String(model_answer || '') : null,
    'manual', nowIso()
  );
  await audit('teacher', req.teacher.id, 'question.created', 'exam', acc.exam.id, { type });
  res.status(201).json(await q.get(`SELECT * FROM questions WHERE id = ?`, info.lastInsertRowid));
});

questionsRouter.patch('/questions/:id', async (req, res) => {
  const acc = await questionAccess(req.teacher, req.params.id);
  if (!acc || !acc.question) return bad(res, 'Question not found', 404);
  if (!requireNonTa(acc.role)) return bad(res, 'Not permitted', 403);
  if (acc.question.exam_id && await questionLockedForExam(acc.question.exam_id)) {
    return bad(res, 'Question is locked — the exam already has attempts.', 409);
  }
  const merged = { ...acc.question, ...req.body };
  const err = validateQuestion(merged);
  if (err) return bad(res, err);
  const { type, text, options, correct_index, points, model_answer, flagged } = req.body;
  await q.run(
    `UPDATE questions SET
       text = COALESCE(?, text),
       options_json = COALESCE(?, options_json),
       correct_index = COALESCE(?, correct_index),
       points = COALESCE(?, points),
       model_answer = COALESCE(?, model_answer),
       flagged = COALESCE(?, flagged)
     WHERE id = ?`,
    text ?? null,
    options ? JSON.stringify(options.map((o) => String(o).trim())) : null,
    correct_index ?? null, points == null ? null : Math.max(0.5, Number(points) || 1),
    model_answer ?? null, flagged == null ? null : flagged ? 1 : 0, acc.question.id
  );
  res.json(await q.get(`SELECT * FROM questions WHERE id = ?`, acc.question.id));
});

questionsRouter.delete('/questions/:id', async (req, res) => {
  const acc = await questionAccess(req.teacher, req.params.id);
  if (!acc || !acc.question) return bad(res, 'Question not found', 404);
  if (!requireNonTa(acc.role)) return bad(res, 'Not permitted', 403);
  if (acc.question.exam_id && await questionLockedForExam(acc.question.exam_id)) {
    return bad(res, 'Question is locked — the exam already has attempts.', 409);
  }
  await q.run(`DELETE FROM questions WHERE id = ?`, acc.question.id);
  res.json({ ok: true });
});

questionsRouter.post('/questions/:id/flag', async (req, res) => {
  const acc = await questionAccess(req.teacher, req.params.id);
  if (!acc || !acc.question) return bad(res, 'Question not found', 404);
  const next = acc.question.flagged ? 0 : 1;
  await q.run(`UPDATE questions SET flagged = ? WHERE id = ?`, next, acc.question.id);
  await audit('teacher', req.teacher.id, next ? 'question.flagged' : 'question.unflagged', 'question', acc.question.id);
  res.json({ flagged: !!next });
});

// ------------------------------ Question banks ------------------------------
questionsRouter.get('/courses/:courseId/banks', async (req, res) => {
  const acc = await canAccessCourse(req.teacher, req.params.courseId);
  if (!acc) return bad(res, 'Course not found', 404);
  res.json(await q.all(
    `SELECT b.*, (SELECT COUNT(*) FROM questions WHERE bank_id = b.id) AS questions
     FROM question_banks b WHERE b.course_id = ? ORDER BY b.id`, acc.course.id
  ));
});

questionsRouter.post('/courses/:courseId/banks', async (req, res) => {
  const acc = await canAccessCourse(req.teacher, req.params.courseId);
  if (!acc || !requireNonTa(acc.role)) return bad(res, 'Not permitted', 403);
  const name = String(req.body?.name || '').trim();
  if (!name) return bad(res, 'name is required');
  const info = await q.run(`INSERT INTO question_banks (course_id, name, created_at) VALUES (?,?,?)`, acc.course.id, name, nowIso());
  await audit('teacher', req.teacher.id, 'bank.created', 'course', acc.course.id, { name });
  res.status(201).json(await q.get(`SELECT * FROM question_banks WHERE id = ?`, info.lastInsertRowid));
});

questionsRouter.delete('/banks/:id', async (req, res) => {
  const acc = await bankAccess(req.teacher, req.params.id);
  if (!acc || !acc.bank) return bad(res, 'Bank not found', 404);
  if (!requireNonTa(acc.role)) return bad(res, 'Not permitted', 403);
  await q.run(`DELETE FROM question_banks WHERE id = ?`, acc.bank.id);
  res.json({ ok: true });
});

questionsRouter.get('/banks/:id/questions', async (req, res) => {
  const acc = await bankAccess(req.teacher, req.params.id);
  if (!acc || !acc.bank) return bad(res, 'Bank not found', 404);
  res.json((await q.all(`SELECT * FROM questions WHERE bank_id = ? ORDER BY id`, acc.bank.id))
    .map((r) => ({ ...r, options: r.options_json ? JSON.parse(r.options_json) : null })));
});

questionsRouter.post('/banks/:id/questions', async (req, res) => {
  const acc = await bankAccess(req.teacher, req.params.id);
  if (!acc || !acc.bank) return bad(res, 'Bank not found', 404);
  if (!requireNonTa(acc.role)) return bad(res, 'Not permitted', 403);
  const err = validateQuestion(req.body);
  if (err) return bad(res, err);
  const { type, text, options, correct_index, points, model_answer } = req.body;
  const info = await q.run(
    `INSERT INTO questions (bank_id, type, text, options_json, correct_index, points, model_answer, source, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    acc.bank.id, type, String(text).trim(),
    type === 'mcq' ? JSON.stringify(options.map((o) => String(o).trim())) : null,
    type === 'mcq' ? correct_index : null,
    Math.max(0.5, Number(points) || 1), type === 'essay' ? String(model_answer || '') : null,
    'manual', nowIso()
  );
  res.status(201).json(await q.get(`SELECT * FROM questions WHERE id = ?`, info.lastInsertRowid));
});
