import { q, nowIso, tx } from '../db/index.js';
import { shuffled, rng, audit, parseJson, examEnd } from './util.js';
import { ssePublish } from './sse.js';
import { gradeEssayWithNotes } from './gemini.js';
import fs from 'node:fs';

// ---------------------------------------------------------------------------
// Attempt creation + paper construction
// ---------------------------------------------------------------------------

export async function pickExamQuestions(exam, attemptId) {
  let ids;
  if (exam.question_source === 'bank' && exam.bank_id) {
    const all = (await q.all(`SELECT id FROM questions WHERE bank_id = ?`, exam.bank_id)).map((r) => r.id);
    ids = shuffled(all, rng(attemptId * 7919 + 13)).slice(0, exam.question_count || all.length);
  } else {
    ids = (await q.all(`SELECT id FROM questions WHERE exam_id = ? ORDER BY id`, exam.id)).map((r) => r.id);
    if (exam.question_count && exam.question_count < ids.length) {
      ids = shuffled(ids, rng(attemptId * 7919 + 13)).slice(0, exam.question_count);
    }
  }
  if (exam.shuffle_questions) ids = shuffled(ids, rng(attemptId * 104729 + 7));
  const order = await Promise.all(ids.map(async (qid) => {
    const qRow = await q.get(`SELECT * FROM questions WHERE id = ?`, qid);
    let options = null;
    if (qRow.type === 'mcq') {
      const orig = parseJson(qRow.options_json, []);
      options = orig.map((_, i) => i);
      if (exam.shuffle_options) options = shuffled(options, rng(attemptId * 31 + qid * 17));
    }
    return { question_id: qid, options };
  }));
  return order;
}

export async function createAttempt(exam, studentId) {
  const now = nowIso();
  const info = await q.run(
    `INSERT INTO attempts (exam_id, student_id, status, started_at, ends_at, order_json, last_seen)
     VALUES (?,?,?,?,?, '[]', ?)`,
    exam.id, studentId, 'in_progress', now, examEnd(exam), now
  );
  const attemptId = Number(info.lastInsertRowid);
  const order = await pickExamQuestions(exam, attemptId);
  await q.run(`UPDATE attempts SET order_json = ? WHERE id = ?`, JSON.stringify(order), attemptId);
  return q.get(`SELECT * FROM attempts WHERE id = ?`, attemptId);
}

export async function getAttempt(id) { return q.get(`SELECT * FROM attempts WHERE id = ?`, id); }

export async function buildPaper(attempt, { withAnswers = false } = {}) {
  const order = parseJson(attempt.order_json, []);
  const items = await Promise.all(order.map(async (o, idx) => {
    const qRow = await q.get(`SELECT * FROM questions WHERE id = ?`, o.question_id);
    if (!qRow) return null;
    const base = { position: idx, question_id: qRow.id, type: qRow.type, text: qRow.text, points: qRow.points };
    if (qRow.type === 'mcq') {
      const orig = parseJson(qRow.options_json, []);
      base.options = (o.options || orig.map((_, i) => i)).map((origIdx) => ({ index: origIdx, text: orig[origIdx] }));
      if (withAnswers) base.correct_index = qRow.correct_index;
    } else if (withAnswers) {
      base.model_answer = qRow.model_answer;
    }
    return base;
  }));
  return items.filter(Boolean);
}

export async function savedAnswersFor(attemptId) {
  const attempt = await getAttempt(attemptId);
  const order = parseJson(attempt.order_json, []);
  const rows = await q.all(`SELECT * FROM answers WHERE attempt_id = ?`, attemptId);
  // Answers are stored in ORIGINAL option-index space; convert back to DISPLAYED space for the client.
  const out = [];
  for (const r of rows) {
    const o = order.find((x) => x.question_id === r.question_id);
    let displayed = null;
    if (r.selected_index != null && o) {
      if (o.options) {
        const pos = o.options.indexOf(r.selected_index);
        displayed = pos >= 0 ? pos : null;
      } else displayed = r.selected_index;
    }
    out.push({ question_id: r.question_id, selected_index: displayed, essay_text: r.essay_text });
  }
  return out;
}

// Upsert answers. mcq selected_index arrives in DISPLAYED space → converted to original space.
export async function saveAnswers(attempt, answers) {
  const order = parseJson(attempt.order_json, []);
  const now = nowIso();
  await tx(async (t) => {
    for (const a of answers || []) {
      const o = order.find((x) => x.question_id === Number(a.question_id));
      if (!o) continue;
      const qRow = await t.get(`SELECT * FROM questions WHERE id = ?`, o.question_id);
      if (!qRow) continue;
      let selected = null;
      if (qRow.type === 'mcq' && a.selected_index != null && a.selected_index >= 0) {
        const disp = Number(a.selected_index);
        selected = o.options && o.options[disp] != null ? o.options[disp] : null;
      }
      const essayText = qRow.type === 'essay' ? String(a.essay_text ?? '') : null;
      await t.run(
        `INSERT INTO answers (attempt_id, question_id, selected_index, essay_text, created_at, updated_at)
         VALUES (?,?,?,?,?,?)
         ON CONFLICT(attempt_id, question_id) DO UPDATE SET
           selected_index = excluded.selected_index,
           essay_text = excluded.essay_text,
           updated_at = excluded.updated_at`,
        attempt.id, qRow.id, selected, essayText, now, now
      );
    }
  });
  await refreshAnsweredCount(attempt.id);
}

export async function refreshAnsweredCount(attemptId) {
  await q.run(
    `UPDATE attempts SET answered_count = (
       SELECT COUNT(*) FROM answers WHERE attempt_id = ?
         AND (selected_index IS NOT NULL OR (essay_text IS NOT NULL AND TRIM(essay_text) <> ''))
     ), last_seen = ? WHERE id = ?`,
    attemptId, nowIso(), attemptId
  );
}

// ---------------------------------------------------------------------------
// Finalization + grading
// ---------------------------------------------------------------------------

export async function finalizeAttempt(attemptId, reason = 'submitted') {
  const attempt = await getAttempt(attemptId);
  if (!attempt || attempt.status !== 'in_progress') return attempt;
  const exam = await q.get(`SELECT * FROM exams WHERE id = ?`, attempt.exam_id);
  const order = parseJson(attempt.order_json, []);
  const now = nowIso();

  await tx(async (t) => {
    let maxScore = 0;
    for (const o of order) {
      const qRow = await t.get(`SELECT * FROM questions WHERE id = ?`, o.question_id);
      if (!qRow) continue;
      maxScore += qRow.points;
      const ans = await t.get(`SELECT * FROM answers WHERE attempt_id = ? AND question_id = ?`, attemptId, qRow.id);
      if (qRow.type === 'mcq') {
        if (!ans) {
          // unanswered MCQ — insert graded placeholder
          await t.run(
            `INSERT INTO answers (attempt_id, question_id, selected_index, is_correct, points_awarded, final_score, grading_status, created_at, updated_at)
             VALUES (?,?,?,0,0,0,'auto',?,?)`,
            attemptId, qRow.id, null, now, now
          );
        } else {
          const correct = ans.selected_index != null && ans.selected_index === qRow.correct_index ? 1 : 0;
          const pts = correct ? qRow.points : 0;
          await t.run(
            `UPDATE answers SET is_correct = ?, points_awarded = ?, final_score = ?, grading_status = 'auto', updated_at = ?
             WHERE id = ?`,
            correct, pts, pts, now, ans.id
          );
        }
      } else if (ans) {
        const hasText = ans.essay_text && ans.essay_text.trim() !== '';
        await t.run(
          `UPDATE answers SET grading_status = ?, updated_at = ? WHERE id = ?`,
          exam.ai_grading_enabled && hasText ? 'ai_pending' : 'confirmed', now, ans.id
        );
        if (!exam.ai_grading_enabled || !hasText) {
          // manual grading later; leave final_score NULL until graded (counts 0 for now)
        }
      } else {
        // unanswered essay placeholder so grading queues stay complete
        await t.run(
          `INSERT INTO answers (attempt_id, question_id, essay_text, grading_status, created_at, updated_at)
           VALUES (?,?,?,?,?,?)`,
          attemptId, qRow.id, '', 'confirmed', now, now
        );
      }
    }
    const status = reason === 'submitted' ? 'submitted' : reason === 'terminated' ? 'terminated' : 'auto_submitted';
    await t.run(
      `UPDATE attempts SET status = ?, submitted_at = ?, max_score = ?, last_seen = ? WHERE id = ?`,
      status, now, maxScore, now, attemptId
    );
  });

  await recomputeScore(attemptId);

  const essayPending = (await q.all(
    `SELECT id FROM answers WHERE attempt_id = ? AND grading_status = 'ai_pending'`, attemptId
  )).map((r) => r.id);
  if (essayPending.length) enqueueAiGrading(attemptId, essayPending);

  const updated = await getAttempt(attemptId);
  await audit('system', null, 'exam.' + (reason === 'submitted' ? 'submitted' : reason),
    'attempt', attemptId, { exam_id: attempt.exam_id, reason });
  ssePublish(attempt.exam_id, 'attempt', { type: 'attempt', attemptId, status: updated.status });
  return updated;
}

export async function recomputeScore(attemptId) {
  await q.run(
    `UPDATE attempts SET score = (
       SELECT COALESCE(SUM(COALESCE(final_score, points_awarded, 0)), 0)
       FROM answers WHERE attempt_id = ?
     ) WHERE id = ?`,
    attemptId, attemptId
  );
}

// ---------------------------------------------------------------------------
// Async AI essay grading queue (Render job-queue analogue)
// ---------------------------------------------------------------------------

const aiQueue = [];
let aiWorkerBusy = false;

export function enqueueAiGrading(attemptId, answerIds) {
  aiQueue.push({ attemptId, answerIds });
  setTimeout(pumpAiQueue, 50);
}

async function pumpAiQueue() {
  if (aiWorkerBusy) return;
  aiWorkerBusy = true;
  try {
    while (aiQueue.length) {
      const job = aiQueue.shift();
      try { await gradeEssays(job); } catch (e) {
        console.error('[ai-grader]', e.message);
      }
    }
  } finally { aiWorkerBusy = false; }
}

async function notesExcerptFor(attempt) {
  const exam = await q.get(`SELECT * FROM exams WHERE id = ?`, attempt.exam_id);
  const notes = await q.all(`SELECT * FROM notes WHERE course_id = ? ORDER BY id DESC LIMIT 3`, exam.course_id);
  let text = '';
  for (const n of notes) {
    try { text += '\n' + fs.readFileSync(n.stored_path + '.txt', 'utf8'); } catch { /* missing */ }
    if (text.length > 12000) break;
  }
  return text.slice(0, 12000);
}

async function gradeEssays({ attemptId, answerIds }) {
  const attempt = await getAttempt(attemptId);
  const excerpt = await notesExcerptFor(attempt);
  for (const answerId of answerIds) {
    const ans = await q.get(`SELECT * FROM answers WHERE id = ?`, answerId);
    // Never let AI overwrite a suggestion that already exists or a teacher's decision.
    if (!ans || ans.grading_status !== 'ai_pending' || ans.ai_score != null) continue;
    const qRow = await q.get(`SELECT * FROM questions WHERE id = ?`, ans.question_id);
    try {
      const { score, rationale } = await gradeEssayWithNotes({
        question: qRow.text,
        modelAnswer: qRow.model_answer || '',
        notesExcerpt: excerpt,
        studentAnswer: ans.essay_text || '',
        points: qRow.points,
      });
      await q.run(
        `UPDATE answers SET ai_score = ?, ai_rationale = ?, updated_at = ? WHERE id = ?`,
        score, rationale, nowIso(), answerId
      );
    } catch (e) {
      await q.run(
        `UPDATE answers SET ai_rationale = ?, updated_at = ? WHERE id = ?`,
        `AI grading failed (${e.message}). Please grade manually.`, nowIso(), answerId
      );
    }
    ssePublish(attempt.exam_id, 'grading', { type: 'grading', answerId });
  }
  await audit('system', null, 'ai.essays_graded', 'attempt', attemptId, { count: answerIds.length });
}
