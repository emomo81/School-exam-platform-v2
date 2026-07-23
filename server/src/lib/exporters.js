import PDFDocument from 'pdfkit';
import { q } from '../db/index.js';
import { toCsv, examStatus, fmtPct, parseJson } from './util.js';

// ---------------------------------------------------------------------------
// Data assembly
// ---------------------------------------------------------------------------

export function examResultsRows(examId) {
  return q.all(
    `SELECT a.*, st.roll_no, st.name AS student_name,
            (SELECT COUNT(*) FROM violations v WHERE v.attempt_id = a.id) AS vios
     FROM attempts a JOIN students st ON st.id = a.student_id
     WHERE a.exam_id = ? ORDER BY st.roll_no`, examId
  );
}

export function examQuestionStats(examId) {
  const exam = q.get(`SELECT * FROM exams WHERE id = ?`, examId);
  let questions;
  if (exam.question_source === 'bank' && exam.bank_id) {
    questions = q.all(
      `SELECT DISTINCT q.* FROM questions q
       JOIN answers a ON a.question_id = q.id
       JOIN attempts at ON at.id = a.attempt_id
       WHERE at.exam_id = ?`, examId
    );
    if (!questions.length) questions = q.all(`SELECT * FROM questions WHERE bank_id = ?`, exam.bank_id);
  } else {
    questions = q.all(`SELECT * FROM questions WHERE exam_id = ? ORDER BY id`, examId);
  }
  return questions.map((qu) => {
    const agg = q.get(
      `SELECT COUNT(*) AS answered,
              SUM(CASE WHEN an.is_correct = 1 THEN 1 ELSE 0 END) AS correct,
              AVG(COALESCE(an.final_score, an.points_awarded, 0)) AS avg_pts
       FROM answers an JOIN attempts at ON at.id = an.attempt_id
       WHERE at.exam_id = ? AND an.question_id = ? AND at.status != 'in_progress'`,
      examId, qu.id
    );
    const attempted = agg.answered || 0;
    return {
      id: qu.id, type: qu.type, text: qu.text, points: qu.points,
      attempted,
      correct: agg.correct || 0,
      pct_correct: qu.type === 'mcq' && attempted ? Math.round(((agg.correct || 0) / attempted) * 1000) / 10 : null,
      avg_score: Math.round((agg.avg_pts || 0) * 10) / 10,
    };
  });
}

export function examSummaryStats(examId, passPct) {
  const rows = examResultsRows(examId).filter((r) => r.status !== 'in_progress');
  const pcts = rows.map((r) => fmtPct(r.score || 0, r.max_score || 0));
  const sorted = [...pcts].sort((a, b) => a - b);
  const avg = pcts.length ? pcts.reduce((s, x) => s + x, 0) / pcts.length : 0;
  const median = sorted.length ? (sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2) : 0;
  return {
    participants: rows.length,
    avg: Math.round(avg * 10) / 10,
    median: Math.round(median * 10) / 10,
    min: sorted.length ? sorted[0] : 0,
    max: sorted.length ? sorted[sorted.length - 1] : 0,
    pass: pcts.filter((p) => p >= passPct).length,
    fail: pcts.filter((p) => p < passPct).length,
  };
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

export function examCsv(examId) {
  const exam = q.get(`SELECT e.*, c.code AS course_code, c.title AS course_title FROM exams e JOIN courses c ON c.id = e.course_id WHERE e.id = ?`, examId);
  const rows = examResultsRows(examId);
  const qStats = examQuestionStats(examId);
  const out = [
    [`ExamPro Results — ${exam.course_code}: ${exam.title}`],
    [`Course`, `${exam.course_code} — ${exam.course_title}`],
    [`Start`, exam.start_at],
    [`Duration (min)`, exam.duration_min],
    [`Exported`, new Date().toISOString()],
    [],
    ['Roll No', 'Student', 'Status', 'Violations', 'Answered', 'Score', 'Max', 'Percent', 'Result'],
  ];
  for (const r of rows) {
    const pct = fmtPct(r.score || 0, r.max_score || 0);
    out.push([
      r.roll_no, r.student_name, r.status, r.vios, r.answered_count,
      r.score ?? '', r.max_score ?? '', pct,
      r.status === 'in_progress' ? 'In progress' : pct >= exam.pass_pct ? 'PASS' : 'FAIL',
    ]);
  }
  out.push([], ['Question Analytics'], ['#', 'Type', 'Question', 'Points', 'Attempted', '% Correct', 'Avg Score']);
  qStats.forEach((s, i) => out.push([i + 1, s.type, s.text.slice(0, 120), s.points, s.attempted, s.pct_correct ?? '—', s.avg_score]));
  return toCsv(out);
}

export function courseCsv(courseId) {
  const course = q.get(`SELECT * FROM courses WHERE id = ?`, courseId);
  const exams = q.all(`SELECT * FROM exams WHERE course_id = ? ORDER BY start_at`, courseId);
  const roster = q.all(
    `SELECT st.* FROM enrollments en JOIN students st ON st.id = en.student_id WHERE en.course_id = ? ORDER BY st.roll_no`, courseId
  );
  const header = ['Roll No', 'Student', ...exams.map((e) => `${e.title} (%)`), 'Course Avg (%)'];
  const rows = [[`ExamPro Course Roll-Up — ${course.code}: ${course.title} (${course.term})`], [], header];
  for (const st of roster) {
    const cells = [st.roll_no, st.name];
    let sum = 0, n = 0;
    for (const ex of exams) {
      const a = q.get(`SELECT * FROM attempts WHERE exam_id = ? AND student_id = ? AND status != 'in_progress'`, ex.id, st.id);
      if (a && a.max_score) { const p = fmtPct(a.score || 0, a.max_score); cells.push(p); sum += p; n++; }
      else cells.push('—');
    }
    cells.push(n ? Math.round((sum / n) * 10) / 10 : '—');
    rows.push(cells);
  }
  return toCsv(rows);
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

function tableRow(doc, y, cols, widths, x0 = 50, bold = false) {
  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5);
  let x = x0;
  cols.forEach((c, i) => {
    doc.text(String(c ?? ''), x + 3, y + 4, { width: widths[i] - 6, ellipsis: true, lineBreak: false });
    x += widths[i];
  });
}

function drawTable(doc, headers, rows, widths) {
  const x0 = 50;
  let y = doc.y + 6;
  const paintHeader = () => {
    doc.save().rect(x0, y, widths.reduce((a, b) => a + b, 0), 18).fill('#eef2ff').restore();
    doc.fillColor('#1f2937');
    tableRow(doc, y, headers, widths, x0, true);
    y += 18;
  };
  paintHeader();
  doc.fillColor('#111827');
  for (const r of rows) {
    if (y > doc.page.height - 70) { doc.addPage(); y = 50; paintHeader(); doc.fillColor('#111827'); }
    tableRow(doc, y, r, widths, x0);
    doc.moveTo(x0, y + 16).lineTo(x0 + widths.reduce((a, b) => a + b, 0), y + 16)
      .strokeColor('#e5e7eb').lineWidth(0.5).stroke();
    y += 16;
  }
  doc.y = y + 8;
}

export function streamExamPdf(examId, res) {
  const exam = q.get(`SELECT e.*, c.code AS course_code, c.title AS course_title, c.term FROM exams e JOIN courses c ON c.id = e.course_id WHERE e.id = ?`, examId);
  const stats = examSummaryStats(examId, exam.pass_pct);
  const rows = examResultsRows(examId);
  const qStats = examQuestionStats(examId);

  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="exam-${examId}-results.pdf"`);
  doc.pipe(res);

  doc.fontSize(18).fillColor('#111827').text('ExamPro — Exam Results Report');
  doc.moveDown(0.3);
  doc.fontSize(12).fillColor('#374151').text(`${exam.course_code} — ${exam.course_title} (${exam.term})`);
  doc.fontSize(11).text(`${exam.title}`, { continued: false });
  doc.moveDown(0.5);
  doc.fontSize(9).fillColor('#6b7280')
    .text(`Start: ${exam.start_at}   Duration: ${exam.duration_min} min   Pass mark: ${exam.pass_pct}%   Status: ${examStatus(exam)}`)
    .text(`Exported: ${new Date().toISOString()}`);
  doc.moveDown(0.8);
  doc.fontSize(10).fillColor('#111827').text(
    `Participants: ${stats.participants}    Average: ${stats.avg}%    Median: ${stats.median}%    Range: ${stats.min}%–${stats.max}%    Pass: ${stats.pass}    Fail: ${stats.fail}`
  );
  doc.moveDown(0.6);

  doc.fontSize(12).fillColor('#111827').text('Per-Student Results');
  drawTable(doc,
    ['Roll No', 'Student', 'Status', 'Viol.', 'Score', 'Max', '%', 'Result'],
    rows.map((r) => {
      const pct = fmtPct(r.score || 0, r.max_score || 0);
      return [r.roll_no, r.student_name, r.status, r.vios, r.score ?? '—', r.max_score ?? '—', pct,
        r.status === 'in_progress' ? '—' : pct >= exam.pass_pct ? 'PASS' : 'FAIL'];
    }),
    [60, 150, 70, 40, 50, 45, 45, 55]
  );

  doc.addPage();
  doc.fontSize(12).fillColor('#111827').text('Per-Question Analytics (item difficulty)');
  drawTable(doc,
    ['#', 'Type', 'Question', 'Pts', 'Attempted', '% Correct', 'Avg'],
    qStats.map((s, i) => [i + 1, s.type.toUpperCase(), s.text.slice(0, 90), s.points, s.attempted, s.pct_correct ?? '—', s.avg_score]),
    [25, 40, 260, 30, 60, 55, 45]
  );
  doc.end();
}

export function streamStudentPdf(examId, studentId, res) {
  const exam = q.get(`SELECT e.*, c.code AS course_code, c.title AS course_title, c.term FROM exams e JOIN courses c ON c.id = e.course_id WHERE e.id = ?`, examId);
  const st = q.get(`SELECT * FROM students WHERE id = ?`, studentId);
  const a = q.get(`SELECT * FROM attempts WHERE exam_id = ? AND student_id = ?`, examId, studentId);
  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="report-${st.roll_no}-exam-${examId}.pdf"`);
  doc.pipe(res);

  doc.fontSize(18).fillColor('#111827').text('ExamPro — Student Report Card');
  doc.moveDown(0.4);
  doc.fontSize(11).fillColor('#374151')
    .text(`Student: ${st.name} (${st.roll_no})`)
    .text(`Course: ${exam.course_code} — ${exam.course_title} (${exam.term})`)
    .text(`Exam: ${exam.title}`)
    .text(`Submitted: ${a?.submitted_at || '—'}   Status: ${a?.status || '—'}   Violation flags: ${a?.violations_count ?? 0}`);
  doc.moveDown(0.8);
  const pct = a && a.max_score ? fmtPct(a.score || 0, a.max_score) : 0;
  doc.fontSize(14).fillColor('#111827')
    .text(`Score: ${a?.score ?? 0} / ${a?.max_score ?? '—'}  (${pct}%)  —  ${pct >= exam.pass_pct ? 'PASS' : 'FAIL'}`);
  doc.moveDown(0.8);

  if (a) {
    const order = parseJson(a.order_json, []);
    const rowsP = order.map((o, i) => {
      const qu = q.get(`SELECT * FROM questions WHERE id = ?`, o.question_id);
      const an = q.get(`SELECT * FROM answers WHERE attempt_id = ? AND question_id = ?`, a.id, o.question_id);
      const verdict = qu.type === 'mcq'
        ? (an?.is_correct ? 'Correct' : 'Wrong')
        : (an?.final_score != null ? `${an.final_score}/${qu.points}` : 'Pending review');
      return [i + 1, qu.type.toUpperCase(), qu.text.slice(0, 90), qu.points, verdict];
    });
    doc.fontSize(12).text('Per-Question Outcome');
    drawTable(doc, ['#', 'Type', 'Question', 'Pts', 'Outcome'], rowsP, [25, 45, 285, 35, 90]);
  }
  doc.end();
}
