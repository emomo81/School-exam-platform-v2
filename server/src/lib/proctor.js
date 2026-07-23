import { q, nowIso } from '../db/index.js';
import { VIOLATION_TYPES, audit } from './util.js';
import { ssePublish } from './sse.js';
import { finalizeAttempt } from './grading.js';

// ---------------------------------------------------------------------------
// Violation engine — instructor-configurable severity (PRD 4.7)
//   warn            → record only; never terminates
//   warn_limit      → strike 1: flag + warning, strike 2: final warning, strike 3: terminate (default)
//   zero_tolerance  → first violation terminates the exam
// ---------------------------------------------------------------------------

export async function recordViolation(attempt, type, detail = '') {
  if (!VIOLATION_TYPES[type]) return { error: 'Unknown violation type' };
  if (attempt.status !== 'in_progress') return { ignored: true, reason: 'attempt-not-active' };

  const exam = await q.get(`SELECT * FROM exams WHERE id = ?`, attempt.exam_id);
  const strike = (attempt.violations_count || 0) + 1;
  const now = nowIso();

  await q.run(
    `INSERT INTO violations (attempt_id, type, detail, strike, created_at) VALUES (?,?,?,?,?)`,
    attempt.id, type, String(detail).slice(0, 300), strike, now
  );
  await q.run(`UPDATE attempts SET violations_count = ?, last_seen = ? WHERE id = ?`, strike, now, attempt.id);

  const label = VIOLATION_TYPES[type];
  let action = 'flag';
  let message = `Violation recorded: ${label}.`;
  let terminated = false;

  if (exam.severity_policy === 'zero_tolerance') {
    action = 'terminated'; terminated = true;
    message = `Zero-tolerance policy: exam terminated after violation (${label}).`;
  } else if (exam.severity_policy === 'warn_limit') {
    if (strike === 1) { action = 'warning'; message = `Warning (strike 1 of 3): ${label} detected. Further violations will escalate.`; }
    else if (strike === 2) { action = 'final_warning'; message = `FINAL WARNING (strike 2 of 3): ${label} detected. The next violation will end your exam.`; }
    else { action = 'terminated'; terminated = true; message = `Strike 3 of 3: ${label}. Your exam has been submitted automatically.`; }
  } else { // 'warn'
    action = 'warning';
    message = `Notice: ${label} was detected and recorded (strike ${strike}).`;
  }

  await audit('student', attempt.student_id, 'violation.' + type, 'attempt', attempt.id, { strike, policy: exam.severity_policy });
  ssePublish(attempt.exam_id, 'violation', {
    type: 'violation', attemptId: attempt.id, violationType: type, label, strike, action,
  });

  if (terminated) await finalizeAttempt(attempt.id, 'terminated');
  return { strike, action, terminated, message, label };
}
