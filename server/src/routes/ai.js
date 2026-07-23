import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import { q, nowIso, db } from '../db/index.js';
import { config } from '../config.js';
import { requireTeacher } from '../lib/auth.js';
import { canAccessCourse, examAccess, noteAccess, requireNonTa } from '../lib/access.js';
import { audit, bad } from '../lib/util.js';
import { generateQuestionsFromNotes } from '../lib/gemini.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
export const aiRouter = Router();
aiRouter.use(requireTeacher);

async function extractText(buffer, mime, filename) {
  const lower = (filename || '').toLowerCase();
  if (mime === 'application/pdf' || lower.endsWith('.pdf')) {
    const data = await pdfParse(buffer);
    return data.text || '';
  }
  // txt / md / csv / everything else: best-effort UTF-8 text
  return buffer.toString('utf8').replace(/\x00/g, '');
}

// ------------------------------- Notes upload --------------------------------
aiRouter.post('/courses/:id/notes', upload.single('file'), async (req, res, next) => {
  try {
    const acc = canAccessCourse(req.teacher, req.params.id);
    if (!acc) return bad(res, 'Course not found', 404);
    if (!requireNonTa(acc.role)) return bad(res, 'Not permitted', 403);
    if (!req.file) return bad(res, 'Attach a notes file (.txt, .md, .pdf)');
    const text = await extractText(req.file.buffer, req.file.mimetype, req.file.originalname);
    if (!text.trim()) return bad(res, 'Could not extract any text from that file');
    const fname = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}-${req.file.originalname.replace(/[^\w.\-]/g, '_')}`;
    const stored = path.join(config.uploadsDir, fname);
    fs.writeFileSync(stored, req.file.buffer);
    fs.writeFileSync(stored + '.txt', text, 'utf8');
    const info = q.run(
      `INSERT INTO notes (course_id, filename, stored_path, mime, chars, uploaded_by, created_at)
       VALUES (?,?,?,?,?,?,?)`,
      acc.course.id, req.file.originalname, stored, req.file.mimetype, text.length, req.teacher.id, nowIso()
    );
    audit('teacher', req.teacher.id, 'notes.uploaded', 'course', acc.course.id, { filename: req.file.originalname, chars: text.length });
    res.status(201).json(q.get(`SELECT id, course_id, filename, chars, created_at FROM notes WHERE id = ?`, info.lastInsertRowid));
  } catch (e) { next(e); }
});

aiRouter.delete('/notes/:id', (req, res) => {
  const acc = noteAccess(req.teacher, req.params.id);
  if (!acc || !acc.note) return bad(res, 'Note not found', 404);
  if (!requireNonTa(acc.role)) return bad(res, 'Not permitted', 403);
  try { fs.unlinkSync(acc.note.stored_path); fs.unlinkSync(acc.note.stored_path + '.txt'); } catch { /* gone */ }
  q.run(`DELETE FROM notes WHERE id = ?`, acc.note.id);
  res.json({ ok: true });
});

// ---------------------------- AI question generation -------------------------
// Gemini is called server-side only; everything lands in the review queue.
aiRouter.post('/ai/generate', async (req, res, next) => {
  try {
    const { course_id, note_id, exam_id, mcq_count, essay_count } = req.body || {};
    const acc = canAccessCourse(req.teacher, course_id);
    if (!acc) return bad(res, 'Course not found', 404);
    let exam = null;
    if (exam_id) {
      const ea = examAccess(req.teacher, exam_id);
      if (!ea || ea.exam.course_id !== acc.course.id) return bad(res, 'Exam not in this course', 404);
      exam = ea.exam;
    }
    const noteRows = note_id
      ? q.all(`SELECT * FROM notes WHERE id = ? AND course_id = ?`, Number(note_id), acc.course.id)
      : q.all(`SELECT * FROM notes WHERE course_id = ? ORDER BY id DESC LIMIT 5`, acc.course.id);
    if (!noteRows.length) return bad(res, 'Upload reference notes for this course first (AI Studio → Notes).');
    let notesText = '';
    for (const n of noteRows) {
      try { notesText += `\n\n### ${n.filename}\n${fs.readFileSync(n.stored_path + '.txt', 'utf8')}`; } catch { /* skip */ }
    }
    const mcqCount = Math.min(30, Math.max(0, Number(mcq_count) || 0));
    const essayCount = Math.min(10, Math.max(0, Number(essay_count) || 0));
    if (!mcqCount && !essayCount) return bad(res, 'Request at least one MCQ or essay question');

    const courseLabel = `${acc.course.code} — ${acc.course.title}`;
    const out = await generateQuestionsFromNotes({ notesText, courseLabel, mcqCount, essayCount });

    const tx = db.transaction(() => {
      const ids = [];
      for (const m of out.mcqs.slice(0, mcqCount)) {
        const options = (m.options || []).map((o) => String(o)).filter(Boolean).slice(0, 6);
        if (options.length < 2) continue;
        const ci = Number.isInteger(m.correct_index) && m.correct_index >= 0 && m.correct_index < options.length ? m.correct_index : 0;
        const r = q.run(
          `INSERT INTO ai_generations (course_id, exam_id, note_id, kind, payload_json, status, created_at)
           VALUES (?,?,?,?,?, 'pending', ?)`,
          acc.course.id, exam?.id ?? null, note_id ?? null, 'mcq',
          JSON.stringify({ text: String(m.text || '').trim(), options, correct_index: ci, points: Number(m.points) || 2 }),
          nowIso()
        );
        ids.push(Number(r.lastInsertRowid));
      }
      for (const e of out.essays.slice(0, essayCount)) {
        const qPayload = { text: String(e.text || '').trim(), model_answer: String(e.model_answer || ''), rubric: String(e.rubric || ''), points: Number(e.points) || 10 };
        const r1 = q.run(
          `INSERT INTO ai_generations (course_id, exam_id, note_id, kind, payload_json, status, created_at)
           VALUES (?,?,?,?,?, 'pending', ?)`,
          acc.course.id, exam?.id ?? null, note_id ?? null, 'essay', JSON.stringify(qPayload), nowIso()
        );
        ids.push(Number(r1.lastInsertRowid));
        if (qPayload.rubric) {
          q.run(
            `INSERT INTO ai_generations (course_id, exam_id, note_id, kind, payload_json, status, created_at)
             VALUES (?,?,?,?,?, 'pending', ?)`,
            acc.course.id, exam?.id ?? null, note_id ?? null, 'rubric',
            JSON.stringify({ question: qPayload.text, rubric: qPayload.rubric }), nowIso()
          );
        }
      }
      return ids;
    });
    const created = tx();
    audit('teacher', req.teacher.id, 'ai.questions_generated', 'course', acc.course.id,
      { mcq: mcqCount, essay: essayCount, exam: exam?.title || null });
    res.status(201).json({ created: created.length, ids: created });
  } catch (e) { next(e); }
});

// ------------------------------- Review queue --------------------------------
aiRouter.get('/ai/queue', (req, res) => {
  const courseIds = [
    ...q.all(`SELECT id FROM courses WHERE owner_id = ?`, req.teacher.id).map((r) => r.id),
    ...q.all(`SELECT course_id AS id FROM course_teachers WHERE teacher_id = ?`, req.teacher.id).map((r) => r.id),
  ];
  if (req.teacher.role === 'admin') {
    for (const r of q.all(`SELECT id FROM courses WHERE archived = 0`)) if (!courseIds.includes(r.id)) courseIds.push(r.id);
  }
  if (!courseIds.length) return res.json({ items: [], essay_pending: 0, flagged: 0 });
  const marks = courseIds.map(() => '?').join(',');
  const items = q.all(
    `SELECT g.*, c.code AS course_code, c.title AS course_title, e.title AS exam_title, n.filename AS note_filename
     FROM ai_generations g
     JOIN courses c ON c.id = g.course_id
     LEFT JOIN exams e ON e.id = g.exam_id
     LEFT JOIN notes n ON n.id = g.note_id
     WHERE g.course_id IN (${marks}) AND g.status = 'pending'
     ORDER BY g.id DESC LIMIT 200`, ...courseIds
  ).map((g) => ({ ...g, payload: JSON.parse(g.payload_json) }));
  const essayPending = q.get(
    `SELECT COUNT(*) AS n FROM answers an
     JOIN attempts a ON a.id = an.attempt_id JOIN exams e ON e.id = a.exam_id
     WHERE e.course_id IN (${marks}) AND an.grading_status = 'ai_pending' AND a.status != 'in_progress'`, ...courseIds
  ).n;
  const flagged = q.get(
    `SELECT COUNT(*) AS n FROM (
       SELECT qu.id FROM questions qu JOIN exams e ON e.id = qu.exam_id AND e.course_id IN (${marks}) AND qu.flagged = 1
       UNION ALL
       SELECT qu.id FROM questions qu JOIN question_banks b ON b.id = qu.bank_id AND b.course_id IN (${marks}) AND qu.flagged = 1
     )`, ...courseIds, ...courseIds
  ).n;
  res.json({ items, essay_pending: essayPending, flagged });
});

aiRouter.post('/ai/queue/:id/approve', async (req, res, next) => {
  try {
    const g = q.get(`SELECT * FROM ai_generations WHERE id = ?`, req.params.id);
    if (!g) return bad(res, 'Queue item not found', 404);
    const acc = canAccessCourse(req.teacher, g.course_id);
    if (!acc || !requireNonTa(acc.role)) return bad(res, 'Not permitted', 403);
    if (g.status !== 'pending') return bad(res, 'Already reviewed', 409);
    const payload = JSON.parse(g.payload_json);

    if (g.kind === 'rubric') {
      // Rubrics are informational: approving just acknowledges them.
      q.run(`UPDATE ai_generations SET status = 'approved', reviewed_by = ?, reviewed_at = ? WHERE id = ?`,
        req.teacher.id, nowIso(), g.id);
      return res.json({ ok: true, inserted: 0 });
    }
    // Question kinds → insert into a target exam or bank.
    const targetExamId = req.body?.exam_id || g.exam_id;
    const targetBankId = req.body?.bank_id || null;
    let questions;
    if (targetExamId) {
      const ea = examAccess(req.teacher, targetExamId);
      if (!ea || ea.exam.course_id !== g.course_id) return bad(res, 'Target exam not in this course', 404);
      if (q.get(`SELECT COUNT(*) AS n FROM attempts WHERE exam_id = ?`, ea.exam.id).n > 0) {
        return bad(res, 'Target exam is locked — students have already started.', 409);
      }
      const info = q.run(
        `INSERT INTO questions (exam_id, type, text, options_json, correct_index, points, model_answer, source, created_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        ea.exam.id, g.kind, payload.text,
        g.kind === 'mcq' ? JSON.stringify(payload.options) : null,
        g.kind === 'mcq' ? payload.correct_index : null,
        Math.max(0.5, Number(payload.points) || 1),
        g.kind === 'essay' ? (payload.model_answer || '') : null, 'ai', nowIso()
      );
      questions = Number(info.lastInsertRowid);
    } else if (targetBankId) {
      const bank = q.get(`SELECT * FROM question_banks WHERE id = ? AND course_id = ?`, Number(targetBankId), g.course_id);
      if (!bank) return bad(res, 'Target bank not in this course', 404);
      const info = q.run(
        `INSERT INTO questions (bank_id, type, text, options_json, correct_index, points, model_answer, source, created_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        bank.id, g.kind, payload.text,
        g.kind === 'mcq' ? JSON.stringify(payload.options) : null,
        g.kind === 'mcq' ? payload.correct_index : null,
        Math.max(0.5, Number(payload.points) || 1),
        g.kind === 'essay' ? (payload.model_answer || '') : null, 'ai', nowIso()
      );
      questions = Number(info.lastInsertRowid);
    } else {
      return bad(res, 'Choose a target exam or question bank to approve into.');
    }
    q.run(`UPDATE ai_generations SET status = 'approved', reviewed_by = ?, reviewed_at = ? WHERE id = ?`, req.teacher.id, nowIso(), g.id);
    audit('teacher', req.teacher.id, 'ai.question_approved', 'ai_generation', g.id, { question_id: questions });
    res.json({ ok: true, question_id: questions });
  } catch (e) { next(e); }
});

aiRouter.post('/ai/queue/:id/reject', (req, res) => {
  const g = q.get(`SELECT * FROM ai_generations WHERE id = ?`, req.params.id);
  if (!g) return bad(res, 'Queue item not found', 404);
  const acc = canAccessCourse(req.teacher, g.course_id);
  if (!acc || !requireNonTa(acc.role)) return bad(res, 'Not permitted', 403);
  q.run(`UPDATE ai_generations SET status = 'rejected', reviewed_by = ?, reviewed_at = ? WHERE id = ?`, req.teacher.id, nowIso(), g.id);
  audit('teacher', req.teacher.id, 'ai.question_rejected', 'ai_generation', g.id);
  res.json({ ok: true });
});
