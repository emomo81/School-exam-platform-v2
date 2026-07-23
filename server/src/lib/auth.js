import bcrypt from 'bcryptjs';
import { q, nowIso } from '../db/index.js';
import { token } from './util.js';
import { canAccessCourse } from './access.js';

const TEACHER_COOKIE = 'ep_teacher';
const STUDENT_COOKIE = 'ep_student';
const TEACHER_TTL_H = 72;
const STUDENT_TTL_H = 12;

export function hashPassword(pw) { return bcrypt.hashSync(pw, 10); }
export function checkPassword(pw, hash) { return bcrypt.compareSync(pw, hash); }

export async function createTeacherSession(teacherId) {
  const t = token();
  await q.run(
    `INSERT INTO teacher_sessions (token, teacher_id, created_at, expires_at) VALUES (?,?,?,?)`,
    t, teacherId, nowIso(), new Date(Date.now() + TEACHER_TTL_H * 3600e3).toISOString()
  );
  return t;
}
export async function destroyTeacherSession(t) { await q.run(`DELETE FROM teacher_sessions WHERE token=?`, t); }

export async function requireTeacher(req, res, next) {
  const t = req.cookies?.[TEACHER_COOKIE] || (req.headers.authorization || '').replace(/^Bearer /, '');
  if (!t) return res.status(401).json({ error: 'Not authenticated' });
  const row = await q.get(
    `SELECT s.token, s.expires_at, te.* FROM teacher_sessions s
     JOIN teachers te ON te.id = s.teacher_id WHERE s.token = ?`, t
  );
  if (!row || Date.parse(row.expires_at) < Date.now()) {
    return res.status(401).json({ error: 'Session expired' });
  }
  req.teacher = { id: row.id, name: row.name, email: row.email, role: row.role };
  next();
}

// Admin-only guard
export function requireAdmin(req, res, next) {
  if (req.teacher?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

// Course access: owner OR co-teacher/TA. Attaches req.course + req.courseRole.
export async function requireCourseAccess(req, res, next) {
  const courseId = Number(req.params.id || req.params.courseId);
  const acc = await canAccessCourse(req.teacher, courseId);
  if (!acc) return res.status(acc === null ? 404 : 403).json({ error: 'No access to this course' });
  req.course = acc.course; req.courseRole = acc.role;
  next();
}

// Student session (roll + access code flow) — one active session per roll number.
export async function createStudentSession(studentId, examId, attemptId = null) {
  // enforce one active session per student
  await q.run(`UPDATE student_sessions SET active = 0 WHERE student_id = ? AND active = 1`, studentId);
  const t = token();
  await q.run(
    `INSERT INTO student_sessions (token, student_id, exam_id, attempt_id, active, created_at, expires_at)
     VALUES (?,?,?,?,1,?,?)`,
    t, studentId, examId, attemptId, nowIso(), new Date(Date.now() + STUDENT_TTL_H * 3600e3).toISOString()
  );
  return t;
}
export async function attachAttemptToStudentSession(t, attemptId) {
  await q.run(`UPDATE student_sessions SET attempt_id = ? WHERE token = ?`, attemptId, t);
}

export async function requireStudent(req, res, next) {
  const t = req.cookies?.[STUDENT_COOKIE] || (req.headers.authorization || '').replace(/^Bearer /, '');
  if (!t) return res.status(401).json({ error: 'Not authenticated' });
  const row = await q.get(
    `SELECT ss.token, ss.exam_id, ss.attempt_id, ss.expires_at, st.id AS student_id, st.roll_no, st.name
     FROM student_sessions ss JOIN students st ON st.id = ss.student_id
     WHERE ss.token = ? AND ss.active = 1`, t
  );
  if (!row || Date.parse(row.expires_at) < Date.now()) {
    return res.status(401).json({ error: 'Session expired' });
  }
  req.student = {
    token: t, id: row.student_id, rollNo: row.roll_no, name: row.name,
    examId: row.exam_id, attemptId: row.attempt_id,
  };
  next();
}

export const cookies = { TEACHER_COOKIE, STUDENT_COOKIE };
