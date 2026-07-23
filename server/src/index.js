import express from 'express';
import cookieParser from 'cookie-parser';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { q, nowIso } from './db/index.js';
import { authRouter } from './routes/auth.js';
import { coursesRouter } from './routes/courses.js';
import { examsRouter } from './routes/exams.js';
import { questionsRouter } from './routes/questions.js';
import { studentRouter } from './routes/student.js';
import { monitoringRouter } from './routes/monitoring.js';
import { gradingRouter } from './routes/gradingRouter.js';
import { aiRouter } from './routes/ai.js';
import { analyticsRouter } from './routes/analytics.js';
import { dashboardRouter } from './routes/dashboard.js';
import { exportsRouter } from './routes/exports.js';
import { miscRouter } from './routes/misc.js';
import { finalizeAttempt } from './lib/grading.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '4mb' }));
app.use(cookieParser());

// ------------------------------- API ----------------------------------
app.get('/api/health', (req, res) => res.json({ ok: true, ts: nowIso() }));
app.use('/api/auth', authRouter);
app.use('/api/courses', coursesRouter);
app.use('/api/exams', examsRouter);
app.use('/api/student', studentRouter);   // before catch-all teacher routers (they 401 non-teachers)
app.use('/api', questionsRouter);
app.use('/api', monitoringRouter);
app.use('/api', gradingRouter);
app.use('/api', aiRouter);
app.use('/api', analyticsRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api', exportsRouter);
app.use('/api', miscRouter);

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// Error handler (Express 5 forwards async rejections here)
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || (String(err.message).includes('GEMINI_API_KEY') ? 503 : 500);
  console.error('[error]', status, err.message);
  res.status(status).json({ error: err.message || 'Internal server error' });
});

// ---------------------------- Static SPA -------------------------------
if (fs.existsSync(config.webDist)) {
  app.use(express.static(config.webDist));
  app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(config.webDist, 'index.html')));
} else {
  app.get('/', (req, res) => res.type('text').send(
    'ExamPro API is running. Build the web app first: cd web && npm run build'
  ));
}

// --------------- Server-side timer enforcement (PRD 4.1) ---------------
// pg_cron analogue: periodic sweep auto-submits attempts past the fixed end time.
setInterval(() => {
  try {
    const due = q.all(
      `SELECT id FROM attempts WHERE status = 'in_progress' AND ends_at <= ?`, nowIso()
    );
    for (const a of due) finalizeAttempt(a.id, 'auto');
  } catch (e) { console.error('[cron]', e.message); }
}, 15000);

// Presence sampling for the Live Overview chart (once per minute)
setInterval(() => {
  try {
    const online = q.get(
      `SELECT COUNT(*) AS n FROM attempts WHERE status = 'in_progress'`
    ).n;
    q.run(`INSERT INTO presence_samples (ts, online_count) VALUES (?,?)`, nowIso(), online);
  } catch (e) { console.error('[presence]', e.message); }
}, 60000);

const server = app.listen(config.port, '0.0.0.0', () => {
  console.log(`ExamPro server → http://localhost:${config.port}`);
  console.log(`Gemini AI: ${config.geminiApiKey ? `enabled (${config.geminiModel})` : 'NOT configured — set GEMINI_API_KEY in .env'}`);
});
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`Port ${config.port} is already in use — is another ExamPro server running? Stop it first.`);
    process.exit(1);
  }
  throw e;
});
