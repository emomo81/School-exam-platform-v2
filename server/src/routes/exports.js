import { Router } from 'express';
import { requireTeacher } from '../lib/auth.js';
import { examAccess, canAccessCourse, attemptAccess } from '../lib/access.js';
import { bad, audit } from '../lib/util.js';
import { examCsv, courseCsv, streamExamPdf, streamStudentPdf } from '../lib/exporters.js';

export const exportsRouter = Router();
exportsRouter.use(requireTeacher);

exportsRouter.get('/exams/:id/export.csv', (req, res) => {
  const acc = examAccess(req.teacher, req.params.id);
  if (!acc) return bad(res, 'Exam not found', 404);
  audit('teacher', req.teacher.id, 'export.exam_csv', 'exam', acc.exam.id);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="exam-${acc.exam.id}-results.csv"`);
  res.send(examCsv(acc.exam.id));
});

exportsRouter.get('/exams/:id/export.pdf', (req, res) => {
  const acc = examAccess(req.teacher, req.params.id);
  if (!acc) return bad(res, 'Exam not found', 404);
  audit('teacher', req.teacher.id, 'export.exam_pdf', 'exam', acc.exam.id);
  streamExamPdf(acc.exam.id, res);
});

exportsRouter.get('/courses/:id/export.csv', (req, res) => {
  const acc = canAccessCourse(req.teacher, req.params.id);
  if (!acc) return bad(res, 'Course not found', 404);
  audit('teacher', req.teacher.id, 'export.course_csv', 'course', acc.course.id);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="course-${acc.course.id}-rollup.csv"`);
  res.send(courseCsv(acc.course.id));
});

exportsRouter.get('/attempts/:id/report.pdf', (req, res) => {
  const acc = attemptAccess(req.teacher, req.params.id);
  if (!acc) return bad(res, 'Attempt not found', 404);
  audit('teacher', req.teacher.id, 'export.student_pdf', 'attempt', acc.attempt.id);
  streamStudentPdf(acc.exam.id, acc.attempt.student_id, res);
});
