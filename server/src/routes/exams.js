import { Router } from 'express';
import multer from 'multer';
import { q, nowIso, tx } from '../db/index.js';
import { requireTeacher } from '../lib/auth.js';
import { canAccessCourse, examAccess, requireNonTa } from '../lib/access.js';
import { audit, bad, examStatus, examEnd, accessCode as genCode, parseCsv } from '../lib/util.js';
import { finalizeAttempt, buildPaper } from '../lib/grading.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
export const examsRouter = Router();
examsRouter.use(requireTeacher);

async function examView(e) {
  const participants = await q.get(
    `SELECT COUNT(*) AS n,
            SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS live,
            SUM(CASE WHEN violations_count > 0 THEN 1 ELSE 0 END) AS flagged
     FROM attempts WHERE exam_id = ?`, e.id
  );
  const questions = e.question_source === 'bank' && e.bank_id
    ? (await q.get(`SELECT COUNT(*) AS n FROM questions WHERE bank_id = ?`, e.bank_id)).n
    : (await q.get(`SELECT COUNT(*) AS n FROM questions WHERE exam_id = ?`, e.id)).n;
  const course = await q.get(`SELECT id, code, title, term FROM courses WHERE id = ?`, e.course_id);
  return {
    ...e, course, status: examStatus(e), ends_at: examEnd(e),
    participants: participants.n || 0, live_participants: participants.live || 0,
    flagged: participants.flagged || 0, questions,
  };
}

// All exams visible to this teacher (own + co-taught courses).
examsRouter.get('/', async (req, res) => {
  const courseIds = [
    ...(await q.all(`SELECT id FROM courses WHERE owner_id = ?`, req.teacher.id)).map((r) => r.id),
    ...(await q.all(`SELECT course_id AS id FROM course_teachers WHERE teacher_id = ?`, req.teacher.id)).map((r) => r.id),
  ];
  if (req.teacher.role === 'admin') {
    for (const r of await q.all(`SELECT id FROM courses WHERE archived = 0`)) if (!courseIds.includes(r.id)) courseIds.push(r.id);
  }
  if (!courseIds.length) return res.json([]);
  const marks = courseIds.map(() => '?').join(',');
  const rows = await q.all(`SELECT * FROM exams WHERE course_id IN (${marks}) ORDER BY start_at DESC`, ...courseIds);
  res.json(await Promise.all(rows.map(examView)));
});

examsRouter.post('/', async (req, res) => {
  const b = req.body || {};
  const acc = await canAccessCourse(req.teacher, b.course_id);
  if (!acc) return bad(res, 'Course not found', 404);
  if (!requireNonTa(acc.role)) return bad(res, 'TAs cannot create exams', 403);
  if (!b.title?.trim()) return bad(res, 'title is required');
  if (!b.start_at || isNaN(Date.parse(b.start_at))) return bad(res, 'valid start_at is required');
  const dur = Number(b.duration_min);
  if (!Number.isFinite(dur) || dur < 1 || dur > 1440) return bad(res, 'duration_min must be 1–1440');
  let code = (b.access_code || '').trim().toUpperCase() || genCode(b.title.split(/\s+/)[0].slice(0, 4).toUpperCase());
  if (await q.get(`SELECT 1 AS x FROM exams WHERE UPPER(access_code) = ?`, code)) return bad(res, 'Access code already in use — choose another');
  if (b.question_source === 'bank') {
    const bank = await q.get(`SELECT * FROM question_banks WHERE id = ? AND course_id = ?`, Number(b.bank_id), acc.course.id);
    if (!bank) return bad(res, 'Select a question bank from this course');
  }
  const info = await q.run(
    `INSERT INTO exams (course_id, title, description, access_code, start_at, duration_min,
        shuffle_questions, shuffle_options, allow_backtracking, question_source, bank_id, question_count,
        severity_policy, ai_grading_enabled, use_roster_override, pass_pct, created_by, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    acc.course.id, b.title.trim(), b.description || '', code, new Date(b.start_at).toISOString(), dur,
    b.shuffle_questions ? 1 : 0, b.shuffle_options ? 1 : 0, b.allow_backtracking === false ? 0 : 1,
    b.question_source === 'bank' ? 'bank' : 'custom', b.bank_id || null,
    b.question_count ? Number(b.question_count) : null,
    ['warn', 'warn_limit', 'zero_tolerance'].includes(b.severity_policy) ? b.severity_policy : 'warn_limit',
    b.ai_grading_enabled ? 1 : 0, b.use_roster_override ? 1 : 0,
    Math.min(100, Math.max(1, Number(b.pass_pct) || 50)), req.teacher.id, nowIso()
  );
  await audit('teacher', req.teacher.id, 'exam.created', 'exam', Number(info.lastInsertRowid), { title: b.title, course: acc.course.code });
  res.status(201).json(await examView(await q.get(`SELECT * FROM exams WHERE id = ?`, info.lastInsertRowid)));
});

examsRouter.get('/:id', async (req, res) => {
  const acc = await examAccess(req.teacher, req.params.id);
  if (!acc) return bad(res, 'Exam not found', 404);
  res.json({ ...(await examView(acc.exam)), role: acc.role });
});

examsRouter.patch('/:id', async (req, res) => {
  const acc = await examAccess(req.teacher, req.params.id);
  if (!acc) return bad(res, 'Exam not found', 404);
  if (!requireNonTa(acc.role)) return bad(res, 'TAs cannot edit exam settings', 403);
  const b = req.body || {};
  const anyAttempts = (await q.get(`SELECT COUNT(*) AS n FROM attempts WHERE exam_id = ?`, acc.exam.id)).n > 0;
  if (anyAttempts && (b.start_at || b.duration_min)) {
    return bad(res, 'Timing is locked — students have already started. Use force-close instead.');
  }
  if (b.access_code) {
    const code = String(b.access_code).trim().toUpperCase();
    if (await q.get(`SELECT 1 AS x FROM exams WHERE UPPER(access_code) = ? AND id != ?`, code, acc.exam.id)) {
      return bad(res, 'Access code already in use');
    }
  }
  await q.run(
    `UPDATE exams SET
       title = COALESCE(?, title), description = COALESCE(?, description),
       access_code = COALESCE(?, access_code),
       start_at = COALESCE(?, start_at), duration_min = COALESCE(?, duration_min),
       shuffle_questions = COALESCE(?, shuffle_questions), shuffle_options = COALESCE(?, shuffle_options),
       allow_backtracking = COALESCE(?, allow_backtracking),
       question_source = COALESCE(?, question_source), bank_id = COALESCE(?, bank_id),
       question_count = COALESCE(?, question_count),
       severity_policy = COALESCE(?, severity_policy), ai_grading_enabled = COALESCE(?, ai_grading_enabled),
       use_roster_override = COALESCE(?, use_roster_override), pass_pct = COALESCE(?, pass_pct)
     WHERE id = ?`,
    b.title ?? null, b.description ?? null,
    b.access_code ? String(b.access_code).trim().toUpperCase() : null,
    b.start_at ? new Date(b.start_at).toISOString() : null,
    b.duration_min ? Number(b.duration_min) : null,
    b.shuffle_questions == null ? null : b.shuffle_questions ? 1 : 0,
    b.shuffle_options == null ? null : b.shuffle_options ? 1 : 0,
    b.allow_backtracking == null ? null : b.allow_backtracking ? 1 : 0,
    b.question_source ?? null, b.bank_id ?? null,
    b.question_count == null ? null : Number(b.question_count),
    b.severity_policy ?? null,
    b.ai_grading_enabled == null ? null : b.ai_grading_enabled ? 1 : 0,
    b.use_roster_override == null ? null : b.use_roster_override ? 1 : 0,
    b.pass_pct == null ? null : Number(b.pass_pct),
    acc.exam.id
  );
  await audit('teacher', req.teacher.id, 'exam.updated', 'exam', acc.exam.id);
  res.json(await examView(await q.get(`SELECT * FROM exams WHERE id = ?`, acc.exam.id)));
});

examsRouter.delete('/:id', async (req, res) => {
  const acc = await examAccess(req.teacher, req.params.id);
  if (!acc) return bad(res, 'Exam not found', 404);
  if (!requireNonTa(acc.role)) return bad(res, 'TAs cannot delete exams', 403);
  const n = (await q.get(`SELECT COUNT(*) AS n FROM attempts WHERE exam_id = ?`, acc.exam.id)).n;
  if (n) return bad(res, 'Cannot delete an exam with attempts. Force-close and archive it instead.');
  await q.run(`DELETE FROM exams WHERE id = ?`, acc.exam.id);
  await audit('teacher', req.teacher.id, 'exam.deleted', 'exam', acc.exam.id);
  res.json({ ok: true });
});

// Force-close: lock the window now + auto-submit everything still in progress (PRD 4.1).
examsRouter.post('/:id/close', async (req, res) => {
  const acc = await examAccess(req.teacher, req.params.id);
  if (!acc) return bad(res, 'Exam not found', 404);
  if (!requireNonTa(acc.role)) return bad(res, 'Not permitted', 403);
  const now = nowIso();
  await q.run(`UPDATE exams SET force_closed_at = ? WHERE id = ? AND force_closed_at IS NULL`, now, acc.exam.id);
  const open = await q.all(`SELECT id FROM attempts WHERE exam_id = ? AND status = 'in_progress'`, acc.exam.id);
  for (const a of open) await finalizeAttempt(a.id, 'auto');
  await audit('teacher', req.teacher.id, 'exam.force_closed', 'exam', acc.exam.id, { auto_submitted: open.length });
  res.json({ ok: true, auto_submitted: open.length });
});

examsRouter.post('/:id/release', async (req, res) => {
  const acc = await examAccess(req.teacher, req.params.id);
  if (!acc) return bad(res, 'Exam not found', 404);
  if (!requireNonTa(acc.role)) return bad(res, 'Not permitted', 403);
  await q.run(`UPDATE exams SET results_released = 1 WHERE id = ?`, acc.exam.id);
  await audit('teacher', req.teacher.id, 'results.published', 'exam', acc.exam.id, { title: acc.exam.title });
  res.json({ ok: true });
});

examsRouter.post('/:id/unrelease', async (req, res) => {
  const acc = await examAccess(req.teacher, req.params.id);
  if (!acc) return bad(res, 'Exam not found', 404);
  await q.run(`UPDATE exams SET results_released = 0 WHERE id = ?`, acc.exam.id);
  await audit('teacher', req.teacher.id, 'results.unpublished', 'exam', acc.exam.id);
  res.json({ ok: true });
});

// Teacher paper preview (with answers)
examsRouter.get('/:id/paper', async (req, res) => {
  const acc = await examAccess(req.teacher, req.params.id);
  if (!acc) return bad(res, 'Exam not found', 404);
  let questions;
  if (acc.exam.question_source === 'bank' && acc.exam.bank_id) {
    questions = await q.all(`SELECT * FROM questions WHERE bank_id = ? ORDER BY id`, acc.exam.bank_id);
  } else {
    questions = await q.all(`SELECT * FROM questions WHERE exam_id = ? ORDER BY id`, acc.exam.id);
  }
  res.json(questions.map((qq, i) => ({
    position: i, question_id: qq.id, type: qq.type, text: qq.text, points: qq.points,
    options: qq.type === 'mcq' ? JSON.parse(qq.options_json || '[]').map((text, index) => ({ index, text })) : undefined,
    correct_index: qq.type === 'mcq' ? qq.correct_index : undefined,
    model_answer: qq.type === 'essay' ? qq.model_answer : undefined,
    source: qq.source, flagged: !!qq.flagged,
  })));
});

// --------------------------- Roster override --------------------------------
examsRouter.get('/:id/roster-override', async (req, res) => {
  const acc = await examAccess(req.teacher, req.params.id);
  if (!acc) return bad(res, 'Exam not found', 404);
  const rows = await q.all(
    `SELECT st.id, st.roll_no, st.name, st.email, ero.created_at
     FROM exam_roster_overrides ero JOIN students st ON st.id = ero.student_id
     WHERE ero.exam_id = ? ORDER BY st.roll_no`, acc.exam.id
  );
  res.json(rows);
});

async function upsertStudent(roll, name, email, Q = q) {
  let st = await Q.get(`SELECT * FROM students WHERE UPPER(roll_no) = ?`, roll.toUpperCase());
  if (!st) {
    const info = await Q.run(`INSERT INTO students (roll_no, name, email, created_at) VALUES (?,?,?,?)`,
      roll.toUpperCase(), name || roll.toUpperCase(), email || null, nowIso());
    st = await Q.get(`SELECT * FROM students WHERE id = ?`, info.lastInsertRowid);
  }
  return st;
}

examsRouter.post('/:id/roster-override', upload.single('file'), async (req, res) => {
  const acc = await examAccess(req.teacher, req.params.id);
  if (!acc || !requireNonTa(acc.role)) return bad(res, 'Not permitted', 403);
  let entries = [];
  if (req.file || req.body?.text) {
    const text = req.file ? req.file.buffer.toString('utf8') : String(req.body.text);
    const rows = parseCsv(text);
    const start = rows.length && /roll/i.test(rows[0][0] || '') ? 1 : 0;
    entries = rows.slice(start).map(([roll, name, email]) => ({ roll, name, email }));
  } else if (req.body?.roll_no) {
    entries = [{ roll: req.body.roll_no, name: req.body.name, email: req.body.email }];
  } else return bad(res, 'Provide roll_no or CSV');
  const added = await tx(async (t) => {
    let n = 0;
    for (const e of entries) {
      if (!e.roll?.trim()) continue;
      const st = await upsertStudent(e.roll.trim(), (e.name || '').trim(), (e.email || '').trim(), t);
      const r = await t.run(
        `INSERT OR IGNORE INTO exam_roster_overrides (exam_id, student_id, created_at) VALUES (?,?,?)`,
        acc.exam.id, st.id, nowIso()
      );
      n += r.changes;
    }
    return n;
  });
  await audit('teacher', req.teacher.id, 'exam.roster_override_updated', 'exam', acc.exam.id, { added });
  res.status(201).json({ added });
});

examsRouter.delete('/:id/roster-override/:studentId', async (req, res) => {
  const acc = await examAccess(req.teacher, req.params.id);
  if (!acc || !requireNonTa(acc.role)) return bad(res, 'Not permitted', 403);
  await q.run(`DELETE FROM exam_roster_overrides WHERE exam_id = ? AND student_id = ?`, acc.exam.id, req.params.studentId);
  res.json({ ok: true });
});
