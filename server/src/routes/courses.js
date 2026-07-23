import { Router } from 'express';
import multer from 'multer';
import { q, nowIso, db } from '../db/index.js';
import { requireTeacher } from '../lib/auth.js';
import { canAccessCourse, requireNonTa } from '../lib/access.js';
import { audit, bad, examStatus, examEnd, parseCsv, fmtPct, accessCode } from '../lib/util.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
export const coursesRouter = Router();
coursesRouter.use(requireTeacher);

function courseWithStats(course, role) {
  const exams = q.all(`SELECT * FROM exams WHERE course_id = ? ORDER BY start_at`, course.id);
  const roster = q.get(`SELECT COUNT(*) AS n FROM enrollments WHERE course_id = ?`, course.id).n;
  const activeExams = exams.filter((e) => examStatus(e) !== 'ended');
  // course avg across finished attempts
  const agg = q.get(
    `SELECT AVG(CASE WHEN a.max_score > 0 THEN 100.0 * a.score / a.max_score END) AS avg
     FROM attempts a JOIN exams e ON e.id = a.exam_id
     WHERE e.course_id = ? AND a.status != 'in_progress' AND a.score IS NOT NULL`, course.id
  );
  const prevAvg = null; // trend fetched separately where needed
  return {
    ...course, role, exams_count: exams.length, active_exams: activeExams.length,
    students_count: roster, avg_score: agg.avg != null ? Math.round(agg.avg * 10) / 10 : null,
  };
}

// List courses the teacher owns OR co-teaches.
coursesRouter.get('/', (req, res) => {
  const owned = q.all(`SELECT * FROM courses WHERE owner_id = ? AND archived = 0`, req.teacher.id)
    .map((c) => courseWithStats(c, 'owner'));
  const co = q.all(
    `SELECT c.*, ct.role AS ct_role FROM course_teachers ct JOIN courses c ON c.id = ct.course_id
     WHERE ct.teacher_id = ? AND c.archived = 0`, req.teacher.id
  ).map((c) => courseWithStats(c, c.ct_role));
  const adminAll = req.teacher.role === 'admin'
    ? q.all(`SELECT * FROM courses WHERE archived = 0 AND owner_id != ?`, req.teacher.id).map((c) => courseWithStats(c, 'admin'))
    : [];
  res.json([...owned, ...co, ...adminAll]);
});

coursesRouter.post('/', (req, res) => {
  const { code, title, term, color, term_end } = req.body || {};
  if (!code?.trim() || !title?.trim() || !term?.trim()) return bad(res, 'code, title and term are required');
  const info = q.run(
    `INSERT INTO courses (owner_id, code, title, term, term_end, color, created_at) VALUES (?,?,?,?,?,?,?)`,
    req.teacher.id, code.trim().toUpperCase(), title.trim(), term.trim(), term_end || null,
    color || '#16a34a', nowIso()
  );
  audit('teacher', req.teacher.id, 'course.created', 'course', Number(info.lastInsertRowid), { code });
  res.status(201).json(courseWithStats(q.get(`SELECT * FROM courses WHERE id = ?`, info.lastInsertRowid), 'owner'));
});

coursesRouter.get('/:id', (req, res) => {
  const acc = canAccessCourse(req.teacher, req.params.id);
  if (!acc) return bad(res, 'Course not found', 404);
  const course = courseWithStats(acc.course, acc.role);
  const exams = q.all(`SELECT * FROM exams WHERE course_id = ? ORDER BY start_at DESC`, acc.course.id)
    .map((e) => {
      const qc = e.question_source === 'bank' && e.bank_id
        ? q.get(`SELECT COUNT(*) AS n FROM questions WHERE bank_id = ?`, e.bank_id).n
        : q.get(`SELECT COUNT(*) AS n FROM questions WHERE exam_id = ?`, e.id).n;
      const parts = q.get(
        `SELECT COUNT(*) AS n, SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS live FROM attempts WHERE exam_id = ?`, e.id
      );
      return {
        id: e.id, title: e.title, start_at: e.start_at, duration_min: e.duration_min, ends_at: examEnd(e),
        access_code: e.access_code, status: examStatus(e), questions: qc,
        participants: parts.n || 0, live_participants: parts.live || 0,
        results_released: !!e.results_released, use_roster_override: !!e.use_roster_override,
      };
    });
  const teachers = q.all(
    `SELECT t.id, t.name, t.email, 'owner' AS role FROM courses c JOIN teachers t ON t.id = c.owner_id WHERE c.id = ?
     UNION ALL
     SELECT t.id, t.name, t.email, ct.role FROM course_teachers ct JOIN teachers t ON t.id = ct.teacher_id WHERE ct.course_id = ?`,
    acc.course.id, acc.course.id
  );
  const notes = q.all(`SELECT id, filename, chars, created_at FROM notes WHERE course_id = ? ORDER BY id DESC`, acc.course.id);
  const banks = q.all(
    `SELECT b.*, (SELECT COUNT(*) FROM questions WHERE bank_id = b.id) AS questions
     FROM question_banks b WHERE b.course_id = ? ORDER BY b.id`, acc.course.id
  );
  res.json({ ...course, exams, teachers, notes, banks });
});

coursesRouter.patch('/:id', (req, res) => {
  const acc = canAccessCourse(req.teacher, req.params.id);
  if (!acc || !requireNonTa(acc.role)) return bad(res, 'Not permitted', 403);
  const { code, title, term, color, term_end, archived } = req.body || {};
  q.run(
    `UPDATE courses SET code = COALESCE(?, code), title = COALESCE(?, title), term = COALESCE(?, term),
       color = COALESCE(?, color), term_end = COALESCE(?, term_end), archived = COALESCE(?, archived)
     WHERE id = ?`,
    code ?? null, title ?? null, term ?? null, color ?? null, term_end ?? null,
    archived == null ? null : archived ? 1 : 0, acc.course.id
  );
  audit('teacher', req.teacher.id, 'course.updated', 'course', acc.course.id);
  res.json(courseWithStats(q.get(`SELECT * FROM courses WHERE id = ?`, acc.course.id), acc.role));
});

coursesRouter.delete('/:id', (req, res) => {
  const acc = canAccessCourse(req.teacher, req.params.id);
  if (!acc || acc.role !== 'owner') return bad(res, 'Only the course owner can delete a course', 403);
  q.run(`DELETE FROM courses WHERE id = ?`, acc.course.id);
  audit('teacher', req.teacher.id, 'course.deleted', 'course', acc.course.id);
  res.json({ ok: true });
});

// ------------------------------- Roster ------------------------------------
coursesRouter.get('/:id/roster', (req, res) => {
  const acc = canAccessCourse(req.teacher, req.params.id);
  if (!acc) return bad(res, 'Course not found', 404);
  const rows = q.all(
    `SELECT st.id, st.roll_no, st.name, st.email, en.added_via, en.created_at
     FROM enrollments en JOIN students st ON st.id = en.student_id
     WHERE en.course_id = ? ORDER BY st.roll_no`, acc.course.id
  );
  res.json(rows);
});

function upsertStudent({ roll_no, name, email }) {
  let st = q.get(`SELECT * FROM students WHERE UPPER(roll_no) = ?`, roll_no.toUpperCase());
  if (!st) {
    const info = q.run(
      `INSERT INTO students (roll_no, name, email, created_at) VALUES (?,?,?,?)`,
      roll_no.toUpperCase(), name || roll_no.toUpperCase(), email || null, nowIso()
    );
    st = q.get(`SELECT * FROM students WHERE id = ?`, info.lastInsertRowid);
  } else if (name || email) {
    q.run(`UPDATE students SET name = COALESCE(?, name), email = COALESCE(?, email) WHERE id = ?`,
      name || null, email || null, st.id);
  }
  return st;
}

coursesRouter.post('/:id/roster', (req, res) => {
  const acc = canAccessCourse(req.teacher, req.params.id);
  if (!acc || !requireNonTa(acc.role)) return bad(res, 'Not permitted', 403);
  const { roll_no, name, email } = req.body || {};
  if (!roll_no?.trim()) return bad(res, 'roll_no is required');
  const st = upsertStudent({ roll_no: roll_no.trim(), name: name?.trim(), email: email?.trim() });
  q.run(`INSERT OR IGNORE INTO enrollments (course_id, student_id, added_via, created_at) VALUES (?,?, 'manual', ?)`,
    acc.course.id, st.id, nowIso());
  audit('teacher', req.teacher.id, 'roster.student_added', 'course', acc.course.id, { roll: st.roll_no });
  res.status(201).json(st);
});

coursesRouter.delete('/:id/roster/:studentId', (req, res) => {
  const acc = canAccessCourse(req.teacher, req.params.id);
  if (!acc || !requireNonTa(acc.role)) return bad(res, 'Not permitted', 403);
  q.run(`DELETE FROM enrollments WHERE course_id = ? AND student_id = ?`, acc.course.id, req.params.studentId);
  audit('teacher', req.teacher.id, 'roster.student_removed', 'course', acc.course.id, { student_id: Number(req.params.studentId) });
  res.json({ ok: true });
});

// CSV bulk upload (file OR pasted text). Columns: roll_no, name, email
coursesRouter.post('/:id/roster/csv', upload.single('file'), (req, res) => {
  const acc = canAccessCourse(req.teacher, req.params.id);
  if (!acc || !requireNonTa(acc.role)) return bad(res, 'Not permitted', 403);
  const text = req.file ? req.file.buffer.toString('utf8') : String(req.body?.text || '');
  if (!text.trim()) return bad(res, 'Provide a CSV file or pasted CSV text');
  const rows = parseCsv(text.replace(/^﻿/, ''));
  let start = 0;
  if (rows.length && /roll/i.test(rows[0][0] || '')) start = 1;
  const tx = db.transaction(() => {
    let added = 0, skipped = 0;
    for (let i = start; i < rows.length; i++) {
      const [roll, name, email] = rows[i];
      if (!roll || !roll.trim()) { skipped++; continue; }
      const st = upsertStudent({ roll_no: roll.trim(), name: (name || '').trim(), email: (email || '').trim() });
      const r = q.run(`INSERT OR IGNORE INTO enrollments (course_id, student_id, added_via, created_at) VALUES (?,?, 'csv', ?)`,
        acc.course.id, st.id, nowIso());
      r.changes ? added++ : skipped++;
    }
    return { added, skipped };
  });
  const result = tx();
  audit('teacher', req.teacher.id, 'roster.csv_imported', 'course', acc.course.id, result);
  res.json(result);
});

coursesRouter.get('/:id/roster/template', (req, res) => {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="roster-template.csv"');
  res.send('roll_no,name,email\nSTU-1001,Jane Doe,jane@example.edu\nSTU-1002,John Smith,john@example.edu\n');
});

// --------------------------- Co-teachers / TAs ------------------------------
coursesRouter.get('/:id/teachers', (req, res) => {
  const acc = canAccessCourse(req.teacher, req.params.id);
  if (!acc) return bad(res, 'Course not found', 404);
  const co = q.all(
    `SELECT t.id, t.name, t.email, ct.role, ct.created_at FROM course_teachers ct
     JOIN teachers t ON t.id = ct.teacher_id WHERE ct.course_id = ?`, acc.course.id
  );
  res.json(co);
});

coursesRouter.post('/:id/teachers', (req, res) => {
  const acc = canAccessCourse(req.teacher, req.params.id);
  if (!acc || acc.role !== 'owner') return bad(res, 'Only the course owner can invite teachers', 403);
  const { email, role } = req.body || {};
  const target = q.get(`SELECT * FROM teachers WHERE email = ?`, String(email || '').trim().toLowerCase());
  if (!target) return bad(res, 'No teacher account with that email. Ask them to register first.', 404);
  if (target.id === acc.course.owner_id) return bad(res, 'That teacher already owns this course');
  q.run(`INSERT OR REPLACE INTO course_teachers (course_id, teacher_id, role, created_at) VALUES (?,?,?,?)`,
    acc.course.id, target.id, role === 'ta' ? 'ta' : 'co-teacher', nowIso());
  audit('teacher', req.teacher.id, 'course.teacher_added', 'course', acc.course.id, { email, role });
  res.status(201).json({ ok: true });
});

coursesRouter.delete('/:id/teachers/:teacherId', (req, res) => {
  const acc = canAccessCourse(req.teacher, req.params.id);
  if (!acc || acc.role !== 'owner') return bad(res, 'Only the course owner', 403);
  q.run(`DELETE FROM course_teachers WHERE course_id = ? AND teacher_id = ?`, acc.course.id, req.params.teacherId);
  audit('teacher', req.teacher.id, 'course.teacher_removed', 'course', acc.course.id, { teacher_id: Number(req.params.teacherId) });
  res.json({ ok: true });
});

// ------------------------- Course-level roll-up ------------------------------
coursesRouter.get('/:id/rollup', (req, res) => {
  const acc = canAccessCourse(req.teacher, req.params.id);
  if (!acc) return bad(res, 'Course not found', 404);
  const exams = q.all(`SELECT * FROM exams WHERE course_id = ? ORDER BY start_at`, acc.course.id);
  const roster = q.all(
    `SELECT st.* FROM enrollments en JOIN students st ON st.id = en.student_id WHERE en.course_id = ? ORDER BY st.roll_no`,
    acc.course.id
  );
  const examCols = exams.map((e) => {
    const agg = q.get(
      `SELECT AVG(CASE WHEN max_score > 0 THEN 100.0 * score / max_score END) AS avg, COUNT(*) AS n
       FROM attempts WHERE exam_id = ? AND status != 'in_progress' AND score IS NOT NULL`, e.id
    );
    return {
      id: e.id, title: e.title, start_at: e.start_at, status: examStatus(e),
      results_released: !!e.results_released, participants: agg.n || 0,
      cohort_avg: agg.avg != null ? Math.round(agg.avg * 10) / 10 : null,
    };
  });
  const students = roster.map((st) => {
    const per = examCols.map((col) => {
      const a = q.get(`SELECT * FROM attempts WHERE exam_id = ? AND student_id = ? AND status != 'in_progress'`, col.id, st.id);
      return a && a.max_score ? { exam_id: col.id, pct: fmtPct(a.score || 0, a.max_score), score: a.score, max: a.max_score } : null;
    });
    const done = per.filter(Boolean);
    const avg = done.length ? Math.round((done.reduce((s, x) => s + x.pct, 0) / done.length) * 10) / 10 : null;
    // trend: slope over time (last - first)
    let trend = null;
    if (done.length >= 2) trend = Math.round((done[done.length - 1].pct - done[0].pct) * 10) / 10;
    return { id: st.id, roll_no: st.roll_no, name: st.name, exams: per, avg, trend };
  });
  res.json({ course: { id: acc.course.id, code: acc.course.code, title: acc.course.title, term: acc.course.term }, exams: examCols, students });
});
