import { q } from '../db/index.js';

// Course access: admin | owner | co-teacher | ta  (PRD §2 roles)
export async function canAccessCourse(teacher, courseId) {
  const course = await q.get(`SELECT * FROM courses WHERE id = ?`, Number(courseId));
  if (!course) return null;
  if (teacher.role === 'admin' || course.owner_id === teacher.id) return { course, role: 'owner' };
  const ct = await q.get(`SELECT role FROM course_teachers WHERE course_id = ? AND teacher_id = ?`, course.id, teacher.id);
  if (!ct) return null;
  return { course, role: ct.role };
}

export async function examAccess(teacher, examId) {
  const exam = await q.get(`SELECT * FROM exams WHERE id = ?`, Number(examId));
  if (!exam) return null;
  const acc = await canAccessCourse(teacher, exam.course_id);
  return acc ? { exam, ...acc } : null;
}

export async function bankAccess(teacher, bankId) {
  const bank = await q.get(`SELECT * FROM question_banks WHERE id = ?`, Number(bankId));
  if (!bank) return null;
  const acc = await canAccessCourse(teacher, bank.course_id);
  return acc ? { bank, ...acc } : null;
}

export async function questionAccess(teacher, questionId) {
  const qu = await q.get(`SELECT * FROM questions WHERE id = ?`, Number(questionId));
  if (!qu) return null;
  if (qu.exam_id) {
    const acc = await examAccess(teacher, qu.exam_id);
    return acc ? { question: qu, ...acc } : { question: qu };
  }
  if (qu.bank_id) {
    const acc = await bankAccess(teacher, qu.bank_id);
    return acc ? { question: qu, ...acc } : { question: qu };
  }
  return null;
}

export async function attemptAccess(teacher, attemptId) {
  const attempt = await q.get(`SELECT * FROM attempts WHERE id = ?`, Number(attemptId));
  if (!attempt) return null;
  const acc = await examAccess(teacher, attempt.exam_id);
  return acc ? { attempt, ...acc } : null;
}

export async function noteAccess(teacher, noteId) {
  const note = await q.get(`SELECT * FROM notes WHERE id = ?`, Number(noteId));
  if (!note) return null;
  const acc = await canAccessCourse(teacher, note.course_id);
  return acc ? { note, ...acc } : null;
}

// TAs may read/monitor/grade but not perform destructive or structural actions.
export function requireNonTa(role) {
  return role !== 'ta';
}
