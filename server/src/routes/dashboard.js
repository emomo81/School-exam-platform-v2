import { Router } from 'express';
import { q } from '../db/index.js';
import { requireTeacher } from '../lib/auth.js';
import { examEnd, examStatus, fmtPct, VIOLATION_TYPES } from '../lib/util.js';

export const dashboardRouter = Router();
dashboardRouter.use(requireTeacher);

export async function accessibleCourseIds(teacher) {
  const ids = [
    ...(await q.all(`SELECT id FROM courses WHERE owner_id = ? AND archived = 0`, teacher.id)).map((r) => r.id),
    ...(await q.all(`SELECT course_id AS id FROM course_teachers ct JOIN courses c ON c.id = ct.course_id WHERE ct.teacher_id = ? AND c.archived = 0`, teacher.id)).map((r) => r.id),
  ];
  if (teacher.role === 'admin') {
    for (const r of await q.all(`SELECT id FROM courses WHERE archived = 0`)) if (!ids.includes(r.id)) ids.push(r.id);
  }
  return ids;
}

async function examRosterSize(exam) {
  if (exam.use_roster_override) {
    return (await q.get(`SELECT COUNT(*) AS n FROM exam_roster_overrides WHERE exam_id = ?`, exam.id)).n;
  }
  return (await q.get(`SELECT COUNT(*) AS n FROM enrollments WHERE course_id = ?`, exam.course_id)).n;
}

// Aggregated home payload for the teacher dashboard (one request).
dashboardRouter.get('/summary', async (req, res) => {
  const ids = await accessibleCourseIds(req.teacher);
  const marks = ids.map(() => '?').join(',') || 'NULL';
  const now = new Date();
  const in7 = new Date(now.getTime() + 7 * 86400e3).toISOString();
  const ago7 = new Date(now.getTime() - 7 * 86400e3).toISOString();
  const ago30 = new Date(now.getTime() - 30 * 86400e3).toISOString();
  const ago60 = new Date(now.getTime() - 60 * 86400e3).toISOString();

  const courses = ids.length ? await q.all(`SELECT * FROM courses WHERE id IN (${marks})`, ...ids) : [];
  const exams = ids.length ? await q.all(`SELECT * FROM exams WHERE course_id IN (${marks})`, ...ids) : [];

  const studentsTotal = ids.length
    ? (await q.get(`SELECT COUNT(DISTINCT student_id) AS n FROM enrollments WHERE course_id IN (${marks})`, ...ids)).n
    : 0;

  const withStatus = exams.map((e) => ({ ...e, status: examStatus(e), ends_at: examEnd(e) }));
  const scheduled = withStatus.filter((e) => e.status === 'scheduled');
  const live = withStatus.filter((e) => e.status === 'live');
  const thisWeek = scheduled.filter((e) => e.start_at <= in7);

  // Average score trend: last 30 days vs prior 30 days
  const avgExpr = `AVG(CASE WHEN a.max_score > 0 THEN 100.0 * a.score / a.max_score END)`;
  const recent = ids.length ? (await q.get(
    `SELECT ${avgExpr} AS avg FROM attempts a JOIN exams e ON e.id = a.exam_id
     WHERE e.course_id IN (${marks}) AND a.status != 'in_progress' AND a.submitted_at >= ?`, ...ids, ago30)).avg : null;
  const prior = ids.length ? (await q.get(
    `SELECT ${avgExpr} AS avg FROM attempts a JOIN exams e ON e.id = a.exam_id
     WHERE e.course_id IN (${marks}) AND a.status != 'in_progress' AND a.submitted_at >= ? AND a.submitted_at < ?`, ...ids, ago60, ago30)).avg : null;
  const avgTrend = recent != null && prior != null ? Math.round((recent - prior) * 10) / 10 : null;

  // Integrity (last 7 days)
  const integ = ids.length ? await q.all(
    `SELECT a.violations_count FROM attempts a JOIN exams e ON e.id = a.exam_id
     WHERE e.course_id IN (${marks}) AND a.started_at >= ?`, ...ids, ago7) : [];
  const noIssues = integ.filter((r) => !r.violations_count).length;
  const warnings = integ.filter((r) => r.violations_count === 1).length;
  const viols = integ.filter((r) => r.violations_count >= 2).length;
  const totalInteg = Math.max(1, integ.length);
  const integrity = Math.round((noIssues / totalInteg) * 1000) / 10;

  // Top violation types (last 7 days)
  const top = ids.length ? await q.all(
    `SELECT v.type, COUNT(*) AS n FROM violations v
     JOIN attempts a ON a.id = v.attempt_id JOIN exams e ON e.id = a.exam_id
     WHERE e.course_id IN (${marks}) AND v.created_at >= ?
     GROUP BY v.type ORDER BY n DESC LIMIT 5`, ...ids, ago7) : [];
  const topTotal = Math.max(1, top.reduce((s, r) => s + r.n, 0));

  // AI review queue
  const aiGens = ids.length ? await q.all(
    `SELECT kind, COUNT(*) AS n FROM ai_generations WHERE course_id IN (${marks}) AND status = 'pending' GROUP BY kind`, ...ids) : [];
  const aiEssayPending = ids.length ? (await q.get(
    `SELECT COUNT(*) AS n FROM answers an JOIN attempts a ON a.id = an.attempt_id JOIN exams e ON e.id = a.exam_id
     WHERE e.course_id IN (${marks}) AND an.grading_status = 'ai_pending' AND a.status != 'in_progress'`, ...ids)).n : 0;
  const flaggedQ = ids.length ? ((await q.get(
    `SELECT (SELECT COUNT(*) FROM questions qu JOIN exams e ON e.id = qu.exam_id WHERE e.course_id IN (${marks}) AND qu.flagged = 1) +
            (SELECT COUNT(*) FROM questions qu JOIN question_banks b ON b.id = qu.bank_id WHERE b.course_id IN (${marks}) AND qu.flagged = 1) AS n`, ...ids, ...ids)).n || 0) : 0;
  const aiQueue = [
    { kind: 'essay_grading', label: 'AI Essay Grading', pending: aiEssayPending, unit: 'pending', icon: 'essay' },
    { kind: 'questions', label: 'AI Generated Questions', pending: aiGens.filter((g) => g.kind === 'mcq').reduce((s, g) => s + g.n, 0), unit: 'to review', icon: 'sparkle' },
    { kind: 'rubrics', label: 'AI Suggested Rubrics', pending: aiGens.filter((g) => ['rubric', 'essay'].includes(g.kind)).reduce((s, g) => s + g.n, 0), unit: 'to review', icon: 'rubric' },
    { kind: 'quality', label: 'Question Quality Alerts', pending: flaggedQ, unit: 'flagged', icon: 'alert' },
  ];
  const aiTotal = aiQueue.reduce((s, r) => s + r.pending, 0);

  // Upcoming exams list (next scheduled/live, 4)
  const courseById = new Map(courses.map((c) => [c.id, c]));
  const upcoming = await Promise.all([...live, ...scheduled]
    .sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at))
    .slice(0, 4)
    .map(async (e) => ({
      id: e.id, title: e.title, status: e.status,
      course: `${courseById.get(e.course_id)?.code || ''} — ${courseById.get(e.course_id)?.term || ''}`,
      start_at: e.start_at,
      students: await examRosterSize(e),
    })));

  // Live overview
  const liveExamIds = withStatus.filter((e) => e.status === 'live').map((e) => e.id);
  let liveCounts = { online: 0, active: 0, warning: 0, violations: 0, ending_soon: 0 };
  for (const id of liveExamIds) {
    const st = await q.all(
      `SELECT violations_count, status, ends_at, last_seen FROM attempts WHERE exam_id = ? AND status = 'in_progress'`, id);
    for (const a of st) {
      liveCounts.online++;
      if (a.violations_count >= 2) liveCounts.violations++;
      else if (a.violations_count === 1) liveCounts.warning++;
      else liveCounts.active++;
    }
    for (const a of await q.all(`SELECT ends_at FROM attempts WHERE exam_id = ? AND status = 'in_progress'`, id)) {
      if (Date.parse(a.ends_at) - Date.now() < 15 * 60000) liveCounts.ending_soon++;
    }
  }
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const series = (await q.all(
    `SELECT ts, online_count FROM presence_samples WHERE ts >= ? ORDER BY ts`, todayStart.toISOString()
  )).map((r) => ({ ts: r.ts, n: r.online_count }));
  // Critical alerts: terminated attempts in live exams right now
  let critical = 0;
  for (const id of liveExamIds) {
    critical += (await q.get(`SELECT COUNT(*) AS n FROM attempts WHERE exam_id = ? AND status = 'terminated'`, id)).n;
  }

  // Live exams (right rail)
  const liveExams = await Promise.all(live.map(async (e) => {
    const roster = await examRosterSize(e);
    return {
      id: e.id, title: e.title, status: 'live',
      started_at: e.start_at, ends_at: e.ends_at,
      remaining_ms: Math.max(0, Date.parse(e.ends_at) - Date.now()),
      students: roster,
      online: (await q.get(`SELECT COUNT(*) AS n FROM attempts WHERE exam_id = ? AND status = 'in_progress'`, e.id)).n,
    };
  }));
  const startingSoon = await Promise.all(scheduled
    .filter((e) => Date.parse(e.start_at) - Date.now() < 4 * 3600e3)
    .slice(0, 3)
    .map(async (e) => ({
      id: e.id, title: e.title, status: 'scheduled', starts_at: e.start_at,
      starts_in_ms: Date.parse(e.start_at) - Date.now(), students: await examRosterSize(e),
    })));

  // Course performance cards
  const perf = await Promise.all(courses.map(async (c) => {
    const agg = (await q.get(
      `SELECT AVG(CASE WHEN a.max_score > 0 THEN 100.0 * a.score / a.max_score END) AS avg
       FROM attempts a JOIN exams e ON e.id = a.exam_id WHERE e.course_id = ? AND a.status != 'in_progress' AND a.submitted_at >= ?`,
      c.id, ago30)).avg;
    const prev = (await q.get(
      `SELECT AVG(CASE WHEN a.max_score > 0 THEN 100.0 * a.score / a.max_score END) AS avg
       FROM attempts a JOIN exams e ON e.id = a.exam_id WHERE e.course_id = ? AND a.status != 'in_progress' AND a.submitted_at >= ? AND a.submitted_at < ?`,
      c.id, ago60, ago30)).avg;
    return {
      id: c.id, code: c.code, title: c.title, term: c.term, color: c.color,
      exams: exams.filter((e) => e.course_id === c.id).length,
      students: (await q.get(`SELECT COUNT(*) AS n FROM enrollments WHERE course_id = ?`, c.id)).n,
      avg: agg != null ? Math.round(agg) : null,
      trend: agg != null && prev != null ? Math.round((agg - prev) * 10) / 10 : null,
    };
  }));

  // Recent activity
  const activity = await q.all(
    `SELECT al.*, t.name AS actor_name FROM audit_logs al LEFT JOIN teachers t ON t.id = al.actor_id
     ORDER BY al.id DESC LIMIT 5`
  );

  // Calendar (next 7 days)
  const calendar = withStatus
    .filter((e) => e.start_at <= in7 && e.start_at >= new Date(now.getTime() - 86400e3).toISOString())
    .sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at))
    .slice(0, 6)
    .map((e) => ({
      id: e.id, title: e.title, start_at: e.start_at, status: e.status,
      code: courseById.get(e.course_id)?.code || '',
    }));

  res.json({
    teacher: req.teacher,
    stats: {
      active_courses: courses.length,
      courses_ending_soon: courses.filter((c) => c.term_end && Date.parse(c.term_end) - Date.now() < 21 * 86400e3).length,
      upcoming_exams: scheduled.length + live.length,
      exams_this_week: thisWeek.length + live.length,
      students: studentsTotal,
      avg_score: recent != null ? Math.round(recent) : null,
      avg_score_trend: avgTrend,
      integrity,
      ai_pending: aiTotal,
    },
    upcoming,
    live_overview: {
      online: liveCounts.online, active: liveCounts.active, warning: liveCounts.warning,
      violations: liveCounts.violations, exams_live: liveExamIds.length, paused: 0,
      ending_soon: liveCounts.ending_soon > 0 ? 1 : 0, critical, series,
    },
    ai_queue: aiQueue,
    ai_total: aiTotal,
    course_performance: perf,
    activity,
    integrity_breakdown: { no_issues: noIssues, warnings, violations: viols, integrity },
    top_violations: top.map((r) => ({ ...r, label: VIOLATION_TYPES[r.type] || r.type, pct: Math.round((r.n / topTotal) * 100) })),
    live_exams: [...liveExams, ...startingSoon],
    calendar,
    generated_at: now.toISOString(),
  });
});

// Calendar for a given week offset (0 = current week) — powers the prev/next pager.
dashboardRouter.get('/calendar', async (req, res) => {
  const ids = await accessibleCourseIds(req.teacher);
  const offset = Number(req.query.offset) || 0;
  const start = new Date(); start.setHours(0, 0, 0, 0); start.setTime(start.getTime() + offset * 7 * 86400e3);
  const end = new Date(start.getTime() + 7 * 86400e3);
  if (!ids.length) return res.json({ week_start: start.toISOString(), items: [] });
  const marks = ids.map(() => '?').join(',');
  const courseById = new Map((await q.all(`SELECT id, code, color FROM courses WHERE id IN (${marks})`, ...ids)).map((c) => [c.id, c]));
  const exams = await q.all(
    `SELECT * FROM exams WHERE course_id IN (${marks}) AND start_at >= ? AND start_at < ? ORDER BY start_at`,
    ...ids, start.toISOString(), end.toISOString()
  );
  res.json({
    week_start: start.toISOString(),
    items: exams.map((e) => ({
      id: e.id, title: e.title, start_at: e.start_at, status: examStatus(e),
      code: courseById.get(e.course_id)?.code || '', color: courseById.get(e.course_id)?.color || '#2563eb',
    })),
  });
});
