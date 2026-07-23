// ExamPro end-to-end smoke test — exercises the exact API surface the UI uses.
// Run: node test-e2e.mjs  (server must be running on :4000 with a fresh seed)
const B = 'http://localhost:4000';
let teacherCookie = '';
let studentTok = '';
let passed = 0, failed = 0;

async function call(path, { method = 'GET', body, auth = 'teacher' } = {}) {
  const headers = {};
  if (auth === 'teacher' && teacherCookie) headers.Cookie = teacherCookie;
  if (auth === 'student' && studentTok) headers.Authorization = `Bearer ${studentTok}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(B + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  return { status: res.status, data, headers: res.headers };
}
function ok(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name} ${extra}`); }
}

// ---------- teacher auth ----------
console.log('\n[1] Teacher auth & authorization');
let r = await call('/api/auth/teacher/login', { method: 'POST', body: { email: 'john.doe@exampro.edu', password: 'wrong' }, auth: 'none' });
ok('wrong password rejected', r.status === 401);
r = await call('/api/auth/teacher/login', { method: 'POST', body: { email: 'john.doe@exampro.edu', password: 'demo1234' }, auth: 'none' });
teacherCookie = (r.headers.get('set-cookie') || '').split(';')[0];
ok('teacher login', r.status === 200 && teacherCookie.includes('ep_teacher'));
r = await call('/api/dashboard/summary');
ok('dashboard summary', r.status === 200 && r.data.stats.active_courses === 8, JSON.stringify(r.data).slice(0, 120));

// ---------- course + roster + csv ----------
console.log('\n[2] Course creation, roster & CSV import');
r = await call('/api/courses', { method: 'POST', body: { code: 'TEST 101', title: 'E2E Testing', term: 'Fall 2026' } });
const courseId = r.data.id;
ok('course created', r.status === 201 && courseId > 0);
r = await call(`/api/courses/${courseId}/roster/csv`, { method: 'POST', body: { text: 'roll_no,name,email\nT-001,Test One,t1@x.edu\nT-002,Test Two,t2@x.edu\nT-001,Test One,t1@x.edu\n' } });
ok('csv import dedupes', r.data.added === 2 && r.data.skipped === 1, JSON.stringify(r.data));

// co-teacher invite (TA)
await call('/api/auth/teacher/register', { method: 'POST', body: { name: 'Temp TA', email: 'temp.ta@exampro.edu', password: 'password123' }, auth: 'none' });
r = await call(`/api/courses/${courseId}/teachers`, { method: 'POST', body: { email: 'temp.ta@exampro.edu', role: 'ta' } });
ok('co-teacher (TA) invited', r.status === 201);

// ---------- exam lifecycle ----------
console.log('\n[3] Exam lifecycle');
const startAt = new Date(Date.now() + 60 * 60000).toISOString();
r = await call('/api/exams', { method: 'POST', body: { course_id: courseId, title: 'E2E Exam', start_at: startAt, duration_min: 60, severity_policy: 'warn_limit' } });
ok('exam created', r.status === 201 && r.data.access_code, JSON.stringify(r.data).slice(0, 200));
const examId = r.data.id, code = r.data.access_code;
r = await call('/api/exams', { method: 'POST', body: { course_id: courseId, title: 'Dup Code', start_at: startAt, duration_min: 60, access_code: code } });
ok('duplicate access code blocked', r.status === 400 && /already in use/i.test(r.data.error || ''));
r = await call(`/api/exams/${examId}/questions`, { method: 'POST', body: { type: 'mcq', text: '2+2?', options: ['4', '3', '5', '22'], correct_index: 0, points: 4 } });
ok('mcq added', r.status === 201);
const mcqId = r.data.id;
r = await call(`/api/exams/${examId}/questions`, { method: 'POST', body: { type: 'essay', text: 'Explain testing.', model_answer: 'Tests verify behaviour.', points: 6 } });
ok('essay added', r.status === 201);
const essayId = r.data.id;
// validation
r = await call(`/api/exams/${examId}/questions`, { method: 'POST', body: { type: 'mcq', text: 'bad', options: ['only'], correct_index: 0 } });
ok('bad mcq rejected', r.status === 400);

// TA restrictions
r = await call('/api/auth/teacher/login', { method: 'POST', body: { email: 'temp.ta@exampro.edu', password: 'password123' }, auth: 'none' });
const taCookie = (r.headers.get('set-cookie') || '').split(';')[0];
const saveMain = teacherCookie; teacherCookie = taCookie;
r = await call(`/api/exams/${examId}`, { method: 'PATCH', body: { title: 'TA hack' } });
ok('TA cannot edit exam settings', r.status === 403);
r = await call(`/api/exams/${examId}/monitor`);
ok('TA CAN monitor', r.status === 200);
teacherCookie = saveMain;

// ---------- student flow: roster gate ----------
console.log('\n[4] Student gating (PRD 5.2)');
r = await call('/api/auth/student/login', { method: 'POST', body: { rollNo: 'T-999', accessCode: code }, auth: 'none' });
ok('non-roster roll rejected', r.status === 403);
r = await call('/api/auth/student/login', { method: 'POST', body: { rollNo: 'T-001', accessCode: 'XX-1' }, auth: 'none' });
ok('bad code rejected', r.status === 401);
r = await call('/api/auth/student/login', { method: 'POST', body: { rollNo: 'T-001', accessCode: code }, auth: 'none' });
studentTok = r.data.token;
ok('eligible login issues session', r.status === 200 && !!studentTok);
r = await call('/api/student/start', { method: 'POST', auth: 'student' });
ok('start blocked before window', r.status === 409);

// move exam start to now
r = await call(`/api/exams/${examId}`, { method: 'PATCH', body: { start_at: new Date(Date.now() - 1000).toISOString() } });
ok('exam rescheduled to now', r.status === 200);
r = await call('/api/student/start', { method: 'POST', auth: 'student' });
ok('attempt started', r.status === 200 && r.data.paper.length === 2, JSON.stringify(r.data).slice(0, 160));
const attemptId = r.data.attempt.id;

// one active session per roll
const tok1 = studentTok;
r = await call('/api/auth/student/login', { method: 'POST', body: { rollNo: 'T-001', accessCode: code }, auth: 'none' });
studentTok = r.data.token;
r = await call('/api/student/heartbeat', { method: 'POST', auth: 'student' });
ok('second login allowed (new session)', r.status === 200);
studentTok = tok1;
r = await call('/api/student/heartbeat', { method: 'POST', auth: 'student' });
ok('old session invalidated (one session per roll)', r.status === 401, `got ${r.status}`);
studentTok = r.status === 401 ? (await call('/api/auth/student/login', { method: 'POST', body: { rollNo: 'T-001', accessCode: code }, auth: 'none' })).data.token : studentTok;

// answers + locking of settings/questions after attempts
r = await call('/api/student/sync', { method: 'POST', auth: 'student', body: { answers: [{ question_id: mcqId, selected_index: 0 }, { question_id: essayId, essay_text: 'Testing is verification and validation.' }] } });
ok('answers synced', r.status === 200 && r.data.attempt.answered_count === 2, JSON.stringify(r.data));
r = await call(`/api/exams/${examId}`, { method: 'PATCH', body: { duration_min: 999 } });
ok('timing locked after attempts', r.status === 400);
r = await call(`/api/questions/${mcqId}`, { method: 'DELETE' });
ok('questions locked after attempts', r.status === 409);

// shuffle mapping integrity: patch question points won't matter; correctness mapping checked at submit
r = await call('/api/student/submit', { method: 'POST', auth: 'student', body: { answers: [] } });
ok('submitted', r.status === 200 && r.data.attempt.status === 'submitted');
r = await call(`/api/attempts/${attemptId}`);
const item = r.data.items.find((i) => i.question_id === mcqId);
ok('auto-graded MCQ correct via shuffle mapping', item.is_correct === 1 && item.final_score === 4, JSON.stringify(item));
ok('essay pending teacher review', r.data.items.find((i) => i.question_id === essayId).grading_status === 'confirmed');

// timers: force close auto-submits T-002? (not started — roster shows not_started; close affects only in-progress)
r = await call(`/api/exams/${examId}/close`, { method: 'POST' });
ok('force close ok', r.status === 200);

// results hidden until released
r = await call('/api/student/results', { auth: 'student' });
ok('results hidden pre-release', r.data.released === false);
r = await call(`/api/exams/${examId}/release`, { method: 'POST' });
r = await call('/api/student/results', { auth: 'student' });
const mcqItem = r.data.items.find((i) => i.position);
ok('results visible after release (4/10 pre-essay-grade)', r.data.released === true && r.data.pct === 40, `pct=${r.data.pct}`);
ok('student sees NO correct answers (score+right/wrong only)', !('options' in (mcqItem || {})) && !('model_answer' in (mcqItem || {})), JSON.stringify(mcqItem));
// objective vs essay split: MCQ marks visible now, essays pending → provisional
ok('objective (MCQ) breakdown shown', r.data.objective?.total === 1 && r.data.objective.score === 4 && r.data.objective.max === 4 && r.data.objective.correct === 1, JSON.stringify(r.data.objective));
ok('essay pending → provisional result (no pass/fail yet)', r.data.essay?.count === 1 && r.data.essay.pending === 1 && r.data.complete === false && r.data.pass === null, JSON.stringify(r.data.essay));

// ---------- grading override + audit ----------
console.log('\n[5] Manual & AI-override grading with audit');
r = await call(`/api/exams/${examId}/grading`);
const ansRow = r.data.rows[0];
let aid = ansRow.answer_id;
r = await call(`/api/answers/${aid}/grade`, { method: 'POST', body: { score: 5 } });
ok('manual essay grade stored', r.status === 200);
r = await call(`/api/audit?action=grade`);
ok('grading audited', r.status === 200 && r.data.length > 0);
// once the essay is confirmed, the student's provisional result becomes final
r = await call('/api/student/results', { auth: 'student' });
ok('essay confirmed → final result (9/10, pass shown)', r.data.complete === true && r.data.essay.graded === 1 && r.data.attempt.score === 9 && r.data.pct === 90 && r.data.pass !== null, `score=${r.data.attempt?.score} pct=${r.data.pct} complete=${r.data.complete}`);

// ---------- MCQ-only exam: fully auto-marked, final at release ----------
console.log('\n[4b] MCQ-only exam → fully machine-marked');
r = await call('/api/exams', { method: 'POST', body: { course_id: courseId, title: 'MCQ Only Quiz', start_at: new Date(Date.now() + 3600e3).toISOString(), duration_min: 30 } });
const moId = r.data.id, moCode = r.data.access_code;
ok('mcq-only exam created', r.status === 201 && !!moCode);
await call(`/api/exams/${moId}/questions`, { method: 'POST', body: { type: 'mcq', text: 'Sky color?', options: ['Blue', 'Green'], correct_index: 0, points: 5 } });
await call(`/api/exams/${moId}/questions`, { method: 'POST', body: { type: 'mcq', text: '2+2?', options: ['3', '4'], correct_index: 1, points: 5 } });
await call(`/api/exams/${moId}`, { method: 'PATCH', body: { start_at: new Date(Date.now() - 1000).toISOString() } });
const saveTok = studentTok;
r = await call('/api/auth/student/login', { method: 'POST', body: { rollNo: 'T-002', accessCode: moCode }, auth: 'none' });
studentTok = r.data.token;
const started = await call('/api/student/start', { method: 'POST', auth: 'student' });
ok('mcq-only attempt started (2 questions)', started.status === 200 && started.data.paper.length === 2, `status=${started.status}`);
await call('/api/student/violation', { method: 'POST', auth: 'student', body: { type: 'tab_blur', detail: 'e2e badge trigger' } });
const sub = await call('/api/student/submit', { method: 'POST', auth: 'student', body: { answers: started.data.paper.map((qq) => ({ question_id: qq.question_id, selected_index: 0 })) } });
ok('mcq-only submitted', sub.status === 200 && sub.data.attempt.status === 'submitted');
await call(`/api/exams/${moId}/release`, { method: 'POST' });
r = await call('/api/student/results', { auth: 'student' });
ok('mcq-only: final immediately at release (no pending)', r.data.released === true && r.data.complete === true && r.data.essay.count === 0 && r.data.pass !== null, `complete=${r.data.complete}`);
ok('mcq-only: objective totals cover whole exam', r.data.objective.total === 2 && r.data.objective.max === 10 && r.data.attempt.max_score === 10, JSON.stringify(r.data.objective));
studentTok = saveTok;

// unread badges: student-side violation just created an unseen notification
r = await call('/api/me/badges');
ok('notification badge counts unseen activity', r.status === 200 && r.data.notifications >= 1, JSON.stringify(r.data));
r = await call('/api/me/seen', { method: 'POST', body: { target: 'notifications' } });
ok('mark notifications seen accepted', r.status === 200);
r = await call('/api/me/badges');
ok('notification badge drops to 0 after opening panel', r.data.notifications === 0, JSON.stringify(r.data));

// ---------- AI review queue ----------
console.log('\n[6] AI review queue (human-in-the-loop)');
r = await call('/api/ai/generate', { method: 'POST', body: { course_id: courseId, mcq_count: 3, essay_count: 1 } });
ok('graceful error without notes', r.status === 400 || r.status === 503, `${r.status}`);
// upload notes then generate (503 expected without key)
const fd = new FormData();
fd.append('file', new Blob(['2+2 equals 4. The sky is blue due to Rayleigh scattering. Water boils at 100 C at sea level. Testing validates code.'], { type: 'text/plain' }), 'notes.txt');
const up = await fetch(`${B}/api/courses/${courseId}/notes`, { method: 'POST', headers: { Cookie: teacherCookie }, body: fd });
ok('notes uploaded + text extracted', up.status === 201, String(up.status));
r = await call('/api/ai/generate', { method: 'POST', body: { course_id: courseId, mcq_count: 2, essay_count: 1 } });
let genIds = [];
if (r.status === 503) {
  // No GEMINI_API_KEY configured: must fail loudly and clearly (never a silent mock).
  ok('generate: no key → clear 503', /GEMINI_API_KEY/.test(r.data.error || ''), JSON.stringify(r.data).slice(0, 100));
} else {
  // Key configured: must create real pending items in the review queue.
  ok('generate: with key → items queued for review', r.status === 201 && r.data.created >= 1 && r.data.ids.length >= 1, `${r.status} ${JSON.stringify(r.data).slice(0, 100)}`);
  genIds = r.data.ids || [];
  const genCheck = await call('/api/ai/queue');
  ok('generated items pending teacher review', genIds.every((id) => genCheck.data.items.some((i) => i.id === id && i.status === 'pending')));
  // AI queue badge: freshly generated items are "unseen" until the queue is opened
  let br = await call('/api/me/badges');
  ok('ai badge counts new pending items', br.data.ai >= 1, JSON.stringify(br.data));
  await call('/api/me/seen', { method: 'POST', body: { target: 'ai' } });
  br = await call('/api/me/badges');
  ok('ai badge drops to 0 after opening AI Studio', br.data.ai === 0, JSON.stringify(br.data));
}
// approve/reject — deterministic in both modes:
const queueNow = (await call('/api/ai/queue')).data.items;
ok('seeded queue present', queueNow.length > 5);

// (a) items attached to a LOCKED (live / has-attempts) exam must be refused.
//     Identify the live exam dynamically so demo edits can't break this test.
const examsList = (await call('/api/exams')).data;
const liveItem = queueNow.find((i) => i.kind === 'mcq' && i.exam_id && examsList.some((e) => e.id === i.exam_id && e.status === 'live'));
ok('queue item attached to live exam found', !!liveItem, `item=${liveItem?.id} exam=${liveItem?.exam_id}`);
r = await call(`/api/ai/queue/${liveItem.id}/approve`, { method: 'POST', body: {} });
ok('approve into locked/live exam refused', r.status === 409, `${r.status}`);

// (b) approve + reject into a SCHEDULED exam. With a key we use our own
//     just-generated items + a fresh scheduled exam in the SAME test course
//     (consumes no seeded data). Without one we fall back to seeded BIO-201 items.
let approveItem, targetExamId;
if (genIds.length) {
  approveItem = queueNow.find((i) => genIds.includes(i.id) && i.kind === 'mcq');
  r = await call('/api/exams', { method: 'POST', body: { course_id: courseId, title: 'E2E AI Target', start_at: new Date(Date.now() + 864e5).toISOString(), duration_min: 30 } });
  targetExamId = r.data.id;
} else {
  approveItem = queueNow.find((i) => i.kind === 'mcq' && !i.exam_id);
  targetExamId = 3; // seeded midterm in the item's own course (BIO 201)
}
r = await call(`/api/ai/queue/${approveItem?.id}/approve`, { method: 'POST', body: { exam_id: targetExamId } });
ok('approve into scheduled exam works', r.status === 200 && r.data.question_id > 0, JSON.stringify(r.data).slice(0, 120));

let rejId;
if (genIds.length) {
  rejId = queueNow.find((i) => genIds.includes(i.id) && i.id !== approveItem.id)?.id;
} else {
  rejId = (await call('/api/ai/queue')).data.items.find((i) => i.kind === 'mcq' && !i.exam_id)?.id;
}
r = await call(`/api/ai/queue/${rejId}/reject`, { method: 'POST' });
ok('reject works', r.status === 200);

// verify approved question appears on the target exam with AI badge
r = await call(`/api/exams/${targetExamId}/questions`);
ok('approved question now on exam (source=ai)', r.data.some((x) => x.source === 'ai'));

// ---------- monitoring + analytics + exports ----------
console.log('\n[7] Monitoring, analytics, exports');
r = await call(`/api/exams/1/monitor`);
ok('live monitor snapshot', r.status === 200 && r.data.counts.roster === 120 && r.data.students.length === 120);
r = await call('/api/exams/24/analytics');
ok('analytics', r.status === 200 && r.data.stats.participants > 100, `${r.status}`);
const csv = await call('/api/exams/24/export.csv');
ok('csv export', csv.status === 200 && String(csv.data).includes('Roll No'));
const pdf = await fetch(`${B}/api/exams/24/export.pdf`, { headers: { Cookie: teacherCookie } });
ok('pdf export', pdf.status === 200 && (pdf.headers.get('content-type') || '').includes('pdf'));
r = await call('/api/courses/1/rollup');
ok('course rollup', r.status === 200 && r.data.students.length === 120 && r.data.exams.length >= 5);
const cpdf = await fetch(`${B}/api/courses/1/export.csv`, { headers: { Cookie: teacherCookie } });
ok('course csv export', cpdf.status === 200);

// ---------- admin & cleanup ----------
console.log('\n[8] Cleanup rules');
r = await call(`/api/exams/${examId}`, { method: 'DELETE' });
ok('exam with attempts cannot be deleted', r.status === 400);
r = await call(`/api/courses/${courseId}`, { method: 'DELETE' });
ok('owner can delete course (cascades)', r.status === 200);

console.log(`\n═══ RESULT: ${passed} passed, ${failed} failed ═══`);
process.exit(failed ? 1 : 0);
