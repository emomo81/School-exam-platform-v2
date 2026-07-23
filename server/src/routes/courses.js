import { Router } from 'express';
import multer from 'multer';
import { q, nowIso, tx } from '../db/index.js';
import { requireTeacher } from '../lib/auth.js';
import { canAccessCourse, requireNonTa } from '../lib/access.js';
import { audit, bad, examStatus, examEnd, parseCsv, fmtPct, accessCode } from '../lib/util.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
export const coursesRouter = Router();
coursesRouter.use(requireTeacher);

async function courseWithStats(course, role) {
  const exams = await q.all(`SELECT * FROM exams WHERE course_id = ? ORDER BY start_at`, course.id);
  const roster = (await q.get(`SELECT COUNT(*) AS n FROM enrollments WHERE course_id = ?`, course.id)).n;
  const activeExams = exams.filter((e) => examStatus(e) !== 'ended');
  // course avg across finished attempts
  const agg = await q.get(
    `SELECT AVG(CASE WHEN a.max_score > 0 THEN 100.0 * a.score / a.max_score END) AS avg
     FROM attempts a JOIN exams e ON e.id = a.exam_id
     WHERE e.course_id = ? AND a.status != 'in_progress' AND a.score IS NOT NULL`, course.id
  );
  return {
    ...course, role, exams_count: exams.length, active_exams: activeExams.length,
    students_count: roster, avg_score: agg.avg != null ? Math.round(agg.avg * 10) / 10 : null,
  };
}

// List courses the teacher owns OR co-teaches.
coursesRouter.get('/', async (req, res) => {
  const owned = await Promise.all(
    (await q.all(`SELECT * FROM courses WHERE owner_id = ? AND archived = 0`, req.teacher.id))
      .map((c) => courseWithStats(c, 'owner'))
  );
  const co = await Promise.all(
    (await q.all(
      `SELECT c.*, ct.role AS ct_role FROM course_teachers ct JOIN courses c ON c.id = ct.course_id
       WHERE ct.teacher_id = ? AND c.archived = 0`, req.teacher.id
    )).map((c) => courseWithStats(c, c.ct_role))
  );
  const adminAll = req.teacher.role === 'admin'
    ? await Promise.all(
        (await q.all(`SELECT * FROM courses WHERE archived = 0 AND owner_id != ?`, req.teacher.id))
          .map((c) => courseWithStats(c, 'admin'))
      )
    : [];
  res.json([...owned, ...co, ...adminAll]);
});

coursesRouter.post('/', async (req, res) => {
  const { code, title, term, color, term_end } = req.body || {};
  if (!code?.trim() || !title?.trim() || !term?.trim()) return bad(res, 'code, title and term are required');
  const info = await q.run(
    `INSERT INTO courses (owner_id, code, title, term, term_end, color, created_at) VALUES (?,?,?,?,?,?,?)`,
    req.teacher.id, code.trim().toUpperCase(), title.trim(), term.trim(), term_end || null,
    color || '#16a34a', nowIso()
  );
  await audit('teacher', req.teacher.id, 'course.created', 'course', Number(info.lastInsertRowid), { code });
  res.status(201).json(await courseWithStats(await q.get(`SELECT * FROM courses WHERE id = ?`, info.lastInsertRowid), 'owner'));
});

coursesRouter.get('/:id', async (req, res) => {
  const acc = await canAccessCourse(req.teacher, req.params.id);
  if (!acc) return bad(res, 'Course not found', 404);
  const course = await courseWithStats(acc.course, acc.role);
  const exams = await Promise.all(
    (await q.all(`SELECT * FROM exams WHERE course_id = ? ORDER BY start_at DESC`, acc.course.id))
      .map(async (e) => {
        const qc = e.question_source === 'bank' && e.bank_id
          ? (await q.get(`SELECT COUNT(*) AS n FROM questions WHERE bank_id = ?`, e.bank_id)).n
          : (await q.get(`SELECT COUNT(*) AS n FROM questions WHERE exam_id = ?`, e.id)).n;
        const parts = await q.get(
          `SELECT COUNT(*) AS n, SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS live FROM attempts WHERE exam_id = ?`, e.id
        );
        return {
          id: e.id, title: e.title, start_at: e.start_at, duration_min: e.duration_min, ends_at: examEnd(e),
          access_code: e.access_code, status: examStatus(e), questions: qc,
          participants: parts.n || 0, live_participants: parts.live || 0,
          results_released: !!e.results_released, use_roster_override: !!e.use_roster_override,
        };
      })
  );
  const teachers = await q.all(
    `SELECT t.id, t.name, t.email, 'owner' AS role FROM courses c JOIN teachers t ON t.id = c.owner_id WHERE c.id = ?
     UNION ALL
     SELECT t.id, t.name, t.email, ct.role FROM course_teachers ct JOIN teachers t ON t.id = ct.teacher_id WHERE ct.course_id = ?`,
    acc.course.id, acc.course.id
  );
  const notes = await q.all(`SELECT id, filename, chars, created_at FROM notes WHERE course_id = ? ORDER BY id DESC`, acc.course.id);
  const banks = await q.all(
    `SELECT b.*, (SELECT COUNT(*) FROM questions WHERE bank_id = b.id) AS questions
     FROM question_banks b WHERE b.course_id = ? ORDER BY b.id`, acc.course.id
  );
  res.json({ ...course, exams, teachers, notes, banks });
});

coursesRouter.patch('/:id', async (req, res) => {
  const acc = await canAccessCourse(req.teacher, req.params.id);
  if (!acc || !requireNonTa(acc.role)) return bad(res, 'Not permitted', 403);
  const { code, title, term, color, term_end, archived } = req.body || {};
  await q.run(
    `UPDATE courses SET code = COALESCE(?, code), title = COALESCE(?, title), term = COALESCE(?, term),
       color = COALESCE(?, color), term_end = COALESCE(?, term_end), archived = COALESCE(?, archived)
     WHERE id = ?`,
    code ?? null, title ?? null, term ?? null, color ?? null, term_end ?? null,
    archived == null ? null : archived ? 1 : 0, acc.course.id
  );
  await audit('teacher', req.teacher.id, 'course.updated', 'course', acc.course.id);
  res.json(await courseWithStats(await q.get(`SELECT * FROM courses WHERE id = ?`, acc.course.id), acc.role));
});

coursesRouter.delete('/:id', async (req, res) => {
  const acc = await canAccessCourse(req.teacher, req.params.id);
  if (!acc || acc.role !== 'owner') return bad(res, 'Only the course owner can delete a course', 403);
  await q.run(`DELETE FROM courses WHERE id = ?`, acc.course.id);
  await audit('teacher', req.teacher.id, 'course.deleted', 'course', acc.course.id);
  res.json({ ok: true });
});

// ------------------------------- Roster ------------------------------------
coursesRouter.get('/:id/roster', async (req, res) => {
  const acc = await canAccessCourse(req.teacher, req.params.id);
  if (!acc) return bad(res, 'Course not found', 404);
  const rows = await q.all(
    `SELECT st.id, st.roll_no, st.name, st.email, en.added_via, en.created_at
     FROM enrollments en JOIN students st ON st.id = en.student_id
     WHERE en.course_id = ? ORDER BY st.roll_no`, acc.course.id
  );
  res.json(rows);
});

// Upsert a student, optionally within a transaction handle (Q).
async function upsertStudent({ roll_no, name, email }, Q = q) {
  let st = await Q.get(`SELECT * FROM students WHERE UPPER(roll_no) = ?`, roll_no.toUpperCase());
  if (!st) {
    const info = await Q.run(
      `INSERT INTO students (roll_no, name, email, created_at) VALUES (?,?,?,?)`,
      roll_no.toUpperCase(), name || roll_no.toUpperCase(), email || null, nowIso()
    );
    st = await Q.get(`SELECT * FROM students WHERE id = ?`, info.lastInsertRowid);
  } else if (name || email) {
    await Q.run(`UPDATE students SET name = COALESCE(?, name), email = COALESCE(?, email) WHERE id = ?`,
      name || null, email || null, st.id);
  }
  return st;
}

coursesRouter.post('/:id/roster', async (req, res) => {
  const acc = await canAccessCourse(req.teacher, req.params.id);
  if (!acc || !requireNonTa(acc.role)) return bad(res, 'Not permitted', 403);
  const { roll_no, name, email } = req.body || {};
  if (!roll_no?.trim()) return bad(res, 'roll_no is required');
  const st = await upsertStudent({ roll_no: roll_no.trim(), name: name?.trim(), email: email?.trim() });
  await q.run(`INSERT OR IGNORE INTO enrollments (course_id, student_id, added_via, created_at) VALUES (?,?, 'manual', ?)`,
    acc.course.id, st.id, nowIso());
  await audit('teacher', req.teacher.id, 'roster.student_added', 'course', acc.course.id, { roll: st.roll_no });
  res.status(201).json(st);
});

coursesRouter.delete('/:id/roster/:studentId', async (req, res) => {
  const acc = await canAccessCourse(req.teacher, req.params.id);
  if (!acc || !requireNonTa(acc.role)) return bad(res, 'Not permitted', 403);
  await q.run(`DELETE FROM enrollments WHERE course_id = ? AND student_id = ?`, acc.course.id, req.params.studentId);
  await audit('teacher', req.teacher.id, 'roster.student_removed', 'course', acc.course.id, { student_id: Number(req.params.studentId) });
  res.json({ ok: true });
});

// CSV bulk upload (file OR pasted text). Columns: roll_no, name, email
coursesRouter.post('/:id/roster/csv', upload.single('file'), async (req, res) => {
  const acc = await canAccessCourse(req.teacher, req.params.id);
  if (!acc || !requireNonTa(acc.role)) return bad(res, 'Not permitted', 403);
  const text = req.file ? req.file.buffer.toString('utf8') : String(req.body?.text || '');
  if (!text.trim()) return bad(res, 'Provide a CSV file or pasted CSV text');
  const rows = parseCsv(text.replace(/^﻿/, ''));
  let start = 0;
  if (rows.length && /roll/i.test(rows[0][0] || '')) start = 1;
  const result = await tx(async (t) => {
    let added = 0, skipped = 0;
    for (let i = start; i < rows.length; i++) {
      const [roll, name, email] = rows[i];
      if (!roll || !roll.trim()) { skipped++; continue; }
      const st = await upsertStudent({ roll_no: roll.trim(), name: (name || '').trim(), email: (email || '').trim() }, t);
      const r = await t.run(`INSERT OR IGNORE INTO enrollments (course_id, student_id, added_via, created_at) VALUES (?,?, 'csv', ?)`,
        acc.course.id, st.id, nowIso());
      r.changes ? added++ : skipped++;
    }
    return { added, skipped };
  });
  await audit('teacher', req.teacher.id, 'roster.csv_imported', 'course', acc.course.id, result);
  res.json(result);
});

coursesRouter.get('/:id/roster/template', (req, res) => {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="roster-template.csv"');
  res.send('roll_no,name,email\nSTU-1001,Jane Doe,jane@example.edu\nSTU-1002,John Smith,john@example.edu\n');
});

// --------------------------- Co-teachers / TAs ------------------------------
coursesRouter.get('/:id/teachers', async (req, res) => {
  const acc = await canAccessCourse(req.teacher, req.params.id);
  if (!acc) return bad(res, 'Course not found', 404);
  const co = await q.all(
    `SELECT t.id, t.name, t.email, ct.role, ct.created_at FROM course_teachers ct
     JOIN teachers t ON t.id = ct.teacher_id WHERE ct.course_id = ?`, acc.course.id
  );
  res.json(co);
});

coursesRouter.post('/:id/teachers', async (req, res) => {
  const acc = await canAccessCourse(req.teacher, req.params.id);
  if (!acc || acc.role !== 'owner') return bad(res, 'Only the course owner can invite teachers', 403);
  const { email, role } = req.body || {};
  const target = await q.get(`SELECT * FROM teachers WHERE email = ?`, String(email || '').trim().toLowerCase());
  if (!target) return bad(res, 'No teacher account with that email. Ask them to register first.', 404);
  if (target.id === acc.course.owner_id) return bad(res, 'That teacher already owns this course');
  await q.run(
    `INSERT INTO course_teachers (course_id, teacher_id, role, created_at) VALUES (?,?,?,?)
     ON CONFLICT(course_id, teacher_id) DO UPDATE SET role = excluded.role, created_at = excluded.created_at`,
    acc.course.id, target.id, role === 'ta' ? 'ta' : 'co-teacher', nowIso());
  await audit('teacher', req.teacher.id, 'course.teacher_added', 'course', acc.course.id, { email, role });
  res.status(201).json({ ok: true });
});

coursesRouter.delete('/:id/teachers/:teacherId', async (req, res) => {
  const acc = await canAccessCourse(req.teacher, req.params.id);
  if (!acc || acc.role !== 'owner') return bad(res, 'Only the course owner', 403);
  await q.run(`DELETE FROM course_teachers WHERE course_id = ? AND teacher_id = ?`, acc.course.id, req.params.teacherId);
  await audit('teacher', req.teacher.id, 'course.teacher_removed', 'course', acc.course.id, { teacher_id: Number(req.params.teacherId) });
  res.json({ ok: true });
});

// ------------------------- Course-level roll-up ------------------------------
coursesRouter.get('/:id/rollup', async (req, res) => {
  const acc = await canAccessCourse(req.teacher, req.params.id);
  if (!acc) return bad(res, 'Course not found', 404);
  const exams = await q.all(`SELECT * FROM exams WHERE course_id = ? ORDER BY start_at`, acc.course.id);
  const roster = await q.all(
    `SELECT st.* FROM enrollments en JOIN students st ON st.id = en.student_id WHERE en.course_id = ? ORDER BY st.roll_no`,
    acc.course.id
  );
  const examCols = await Promise.all(exams.map(async (e) => {
    const agg = await q.get(
      `SELECT AVG(CASE WHEN max_score > 0 THEN 100.0 * score / max_score END) AS avg, COUNT(*) AS n
       FROM attempts WHERE exam_id = ? AND status != 'in_progress' AND score IS NOT NULL`, e.id
    );
    return {
      id: e.id, title: e.title, start_at: e.start_at, status: examStatus(e),
      results_released: !!e.results_released, participants: agg.n || 0,
      cohort_avg: agg.avg != null ? Math.round(agg.avg * 10) / 10 : null,
    };
  }));
  const students = await Promise.all(roster.map(async (st) => {
    const per = await Promise.all(examCols.map(async (col) => {
      const a = await q.get(`SELECT * FROM attempts WHERE exam_id = ? AND student_id = ? AND status != 'in_progress'`, col.id, st.id);
      return a && a.max_score ? { exam_id: col.id, pct: fmtPct(a.score || 0, a.max_score), score: a.score, max: a.max_score } : null;
    }));
    const done = per.filter(Boolean);
    const avg = done.length ? Math.round((done.reduce((s, x) => s + x.pct, 0) / done.length) * 10) / 10 : null;
    // trend: slope over time (last - first)
    let trend = null;
    if (done.length >= 2) trend = Math.round((done[done.length - 1].pct - done[0].pct) * 10) / 10;
    return { id: st.id, roll_no: st.roll_no, name: st.name, exams: per, avg, trend };
  }));
  res.json({ course: { id: acc.course.id, code: acc.course.code, title: acc.course.title, term: acc.course.term }, exams: examCols, students });
});
