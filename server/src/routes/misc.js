import { Router } from 'express';
import { q, nowIso } from '../db/index.js';
import { config } from '../config.js';
import { requireTeacher } from '../lib/auth.js';
import { accessibleCourseIds } from './dashboard.js';

export const miscRouter = Router();
miscRouter.use(requireTeacher);

// Teacher directory (for co-teacher invites)
miscRouter.get('/teachers', (req, res) => {
  res.json(q.all(`SELECT id, name, email, role FROM teachers ORDER BY name`));
});

// Audit log (PRD §7 auditability) — newest first, filterable.
miscRouter.get('/audit', (req, res) => {
  const action = String(req.query.action || '').trim();
  const limit = Math.min(500, Number(req.query.limit) || 100);
  const rows = action
    ? q.all(
        `SELECT al.*, t.name AS actor_name FROM audit_logs al LEFT JOIN teachers t ON t.id = al.actor_id
         WHERE al.action LIKE ? ORDER BY al.id DESC LIMIT ?`, `%${action}%`, limit)
    : q.all(
        `SELECT al.*, t.name AS actor_name FROM audit_logs al LEFT JOIN teachers t ON t.id = al.actor_id
         ORDER BY al.id DESC LIMIT ?`, limit);
  res.json(rows.map((r) => ({ ...r, meta: JSON.parse(r.meta_json || '{}') })));
});

// ------------------------- Unread badges --------------------------
// Topbar counters behave like an inbox: opening the notifications panel or the
// AI review queue marks everything current as "seen" and the number drops to
// zero; genuinely new items raise it again. (User-requested behavior.)
miscRouter.get('/me/badges', (req, res) => {
  const t = q.get(`SELECT activity_seen_at, ai_seen_at FROM teachers WHERE id = ?`, req.teacher.id);
  const dayAgo = new Date(Date.now() - 86400e3).toISOString();
  const notifCut = t?.activity_seen_at || dayAgo;
  const aiCut = t?.ai_seen_at || dayAgo;

  const notifications = q.get(
    `SELECT COUNT(*) AS n FROM audit_logs
     WHERE created_at > ?
       AND action NOT LIKE 'auth.%' AND action NOT LIKE 'export.%'
       AND NOT (actor_type = 'teacher' AND actor_id = ?)`,
    notifCut, req.teacher.id
  ).n;

  const ids = accessibleCourseIds(req.teacher);
  let ai = 0;
  if (ids.length) {
    const marks = ids.map(() => '?').join(',');
    ai += q.get(
      `SELECT COUNT(*) AS n FROM ai_generations WHERE status = 'pending' AND created_at > ? AND course_id IN (${marks})`,
      aiCut, ...ids
    ).n;
    ai += q.get(
      `SELECT COUNT(*) AS n FROM answers an
       JOIN attempts a ON a.id = an.attempt_id JOIN exams e ON e.id = a.exam_id
       WHERE an.grading_status = 'ai_pending' AND a.status != 'in_progress'
         AND an.created_at > ? AND e.course_id IN (${marks})`,
      aiCut, ...ids
    ).n;
  }
  res.json({ notifications, ai });
});

miscRouter.post('/me/seen', (req, res) => {
  const target = String(req.body?.target || '');
  const col = target === 'ai' ? 'ai_seen_at' : target === 'notifications' ? 'activity_seen_at' : null;
  if (!col) return res.status(400).json({ error: 'target must be "ai" or "notifications"' });
  const at = nowIso();
  q.run(`UPDATE teachers SET ${col} = ? WHERE id = ?`, at, req.teacher.id);
  res.json({ ok: true, target, at });
});

// System status (integrations page)
miscRouter.get('/system/status', (req, res) => {
  const counts = {
    courses: q.get(`SELECT COUNT(*) AS n FROM courses`).n,
    exams: q.get(`SELECT COUNT(*) AS n FROM exams`).n,
    students: q.get(`SELECT COUNT(*) AS n FROM students`).n,
    attempts: q.get(`SELECT COUNT(*) AS n FROM attempts`).n,
  };
  res.json({
    ok: true,
    version: '1.0.0',
    db: 'sqlite (better-sqlite3) — WAL',
    gemini_configured: !!config.geminiApiKey,
    gemini_model: config.geminiModel,
    uptime_sec: Math.round(process.uptime()),
    counts,
  });
});
