import { Router } from 'express';
import { q, nowIso } from '../db/index.js';
import {
  checkPassword, hashPassword, createTeacherSession, destroyTeacherSession,
  createStudentSession, cookies, requireTeacher,
} from '../lib/auth.js';
import { audit, bad, examEnd, examStatus } from '../lib/util.js';
import { config } from '../config.js';

export const authRouter = Router();

// Cross-site frontends (Vercel ↔ Render) need SameSite=None;Secure cookies.
// The token is also returned in the body so the SPA can fall back to Bearer auth.
const cookieOpts = (maxAge) => ({
  httpOnly: true,
  sameSite: config.cookieSecure ? 'none' : 'lax',
  secure: config.cookieSecure,
  maxAge,
});
const bearerOf = (req) => (req.headers.authorization || '').replace(/^Bearer /, '') || null;

// ------------------------------- Teacher -----------------------------------
authRouter.post('/teacher/login', (req, res) => {
  const { email, password } = req.body || {};
  const t = q.get(`SELECT * FROM teachers WHERE email = ?`, String(email || '').trim().toLowerCase());
  if (!t || !checkPassword(String(password || ''), t.password_hash)) {
    return bad(res, 'Invalid email or password', 401);
  }
  const token = createTeacherSession(t.id);
  res.cookie(cookies.TEACHER_COOKIE, token, cookieOpts(72 * 3600e3));
  audit('teacher', t.id, 'auth.login', 'teacher', t.id);
  res.json({ id: t.id, name: t.name, email: t.email, role: t.role, token });
});

// Local dev convenience: open teacher registration (co-teachers must register
// before an owner can invite them). In production, provisioning is admin-only (PRD §3).
authRouter.post('/teacher/register', (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name?.trim() || !email?.trim() || !password) return bad(res, 'name, email and password are required');
  if (String(password).length < 8) return bad(res, 'Password must be at least 8 characters');
  const em = email.trim().toLowerCase();
  if (q.get(`SELECT 1 AS x FROM teachers WHERE email = ?`, em)) return bad(res, 'Email already registered', 409);
  const info = q.run(
    `INSERT INTO teachers (name, email, password_hash, role, created_at) VALUES (?,?,?,?,?)`,
    name.trim(), em, hashPassword(String(password)), 'teacher', nowIso()
  );
  const token = createTeacherSession(Number(info.lastInsertRowid));
  res.cookie(cookies.TEACHER_COOKIE, token, cookieOpts(72 * 3600e3));
  audit('teacher', Number(info.lastInsertRowid), 'auth.registered', 'teacher', Number(info.lastInsertRowid));
  res.status(201).json({ id: Number(info.lastInsertRowid), name: name.trim(), email: em, role: 'teacher', token });
});

authRouter.post('/teacher/logout', (req, res) => {
  const t = req.cookies?.[cookies.TEACHER_COOKIE] || bearerOf(req);
  if (t) destroyTeacherSession(t);
  res.clearCookie(cookies.TEACHER_COOKIE);
  res.json({ ok: true });
});

authRouter.get('/me', requireTeacher, (req, res) => {
  res.json({ ...req.teacher });
});

authRouter.post('/teacher/change-password', requireTeacher, (req, res) => {
  const { current, next } = req.body || {};
  const t = q.get(`SELECT * FROM teachers WHERE id = ?`, req.teacher.id);
  if (!checkPassword(String(current || ''), t.password_hash)) return bad(res, 'Current password is incorrect');
  if (!next || String(next).length < 8) return bad(res, 'New password must be at least 8 characters');
  q.run(`UPDATE teachers SET password_hash = ? WHERE id = ?`, hashPassword(String(next)), t.id);
  audit('teacher', t.id, 'auth.password_changed', 'teacher', t.id);
  res.json({ ok: true });
});

// ------------------------------- Student -----------------------------------
// Login = roll number + exam access code (PRD 5.2). Roster check is course-level
// by default, exam-level override when the exam enables it (PRD §2).
authRouter.post('/student/login', (req, res) => {
  const rollNo = String(req.body?.rollNo || '').trim().toUpperCase();
  const code = String(req.body?.accessCode || '').trim().toUpperCase();
  if (!rollNo || !code) return bad(res, 'Roll number and access code are required');

  const exam = q.get(`SELECT e.*, c.code AS course_code, c.title AS course_title, c.term
                      FROM exams e JOIN courses c ON c.id = e.course_id WHERE UPPER(e.access_code) = ?`, code);
  if (!exam) return bad(res, 'Invalid access code', 401);

  const student = q.get(`SELECT * FROM students WHERE UPPER(roll_no) = ?`, rollNo);
  if (!student) return bad(res, 'Roll number not found on the roster', 403);

  const onRoster = exam.use_roster_override
    ? q.get(`SELECT 1 AS ok FROM exam_roster_overrides WHERE exam_id = ? AND student_id = ?`, exam.id, student.id)
    : q.get(`SELECT 1 AS ok FROM enrollments WHERE course_id = ? AND student_id = ?`, exam.course_id, student.id);
  if (!onRoster) {
    audit('student', student.id, 'auth.denied_not_on_roster', 'exam', exam.id);
    return bad(res, 'Your roll number is not on the roster for this exam. Contact your instructor.', 403);
  }

  const status = examStatus(exam);
  const existing = q.get(`SELECT * FROM attempts WHERE exam_id = ? AND student_id = ?`, exam.id, student.id);

  const token = createStudentSession(student.id, exam.id, existing?.id ?? null);
  res.cookie(cookies.STUDENT_COOKIE, token, cookieOpts(12 * 3600e3));
  audit('student', student.id, 'auth.student_login', 'exam', exam.id);

  res.json({
    token,
    student: { id: student.id, name: student.name, rollNo: student.roll_no },
    exam: {
      id: exam.id, title: exam.title, course: `${exam.course_code} — ${exam.course_title}`,
      start_at: exam.start_at, ends_at: examEnd(exam), duration_min: exam.duration_min,
      status, allow_backtracking: !!exam.allow_backtracking,
      severity_policy: exam.severity_policy,
    },
    attempt: existing
      ? { id: existing.id, status: existing.status, submitted_at: existing.submitted_at }
      : null,
    results_released: !!exam.results_released,
  });
});
