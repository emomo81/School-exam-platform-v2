import React, { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { api, setStudentToken } from '../api.js';
import { Btn, Icon, Spinner, ProgressBar, fmtDur, fmtDateTime } from '../ui.jsx';

const Ctx = createContext(null);
const useExam = () => useContext(Ctx);

function persist(key, val) {
  if (val === undefined) try { return JSON.parse(sessionStorage.getItem(key)); } catch { return null; }
  sessionStorage.setItem(key, JSON.stringify(val));
}

export default function StudentApp() {
  const [session, setSession] = useState(() => persist('ep_session'));
  const [state, setState] = useState(null);
  const saveSession = (s) => { persist('ep_session', s); setSession(s); persist('ep_state', null); setState(null); };
  const ctx = { session, setSession: saveSession, state, setState: (s) => { persist('ep_state', s); setState(s); } };
  useEffect(() => { const s = persist('ep_state'); if (s) setState(s); }, []);
  return (
    <Ctx.Provider value={ctx}>
      <Routes>
        <Route path="login" element={<StudentLogin />} />
        <Route path="lobby" element={<Guard><Lobby /></Guard>} />
        <Route path="room" element={<Guard><ExamRoom /></Guard>} />
        <Route path="done" element={<><Done /></>} />
        <Route path="results" element={<Guard><Results /></Guard>} />
        <Route path="*" element={<Navigate to="login" replace />} />
      </Routes>
    </Ctx.Provider>
  );
}

function Guard({ children }) {
  if (!persist('ep_session')) return <Navigate to="/exam/login" replace />;
  return children;
}

/* ------------------------------- Login -------------------------------------- */
function StudentLogin() {
  const { setSession } = useExam();
  const navigate = useNavigate();
  const [roll, setRoll] = useState('STU-1001');
  const [code, setCode] = useState('CARD-7291');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true); setErr('');
    try {
      const r = await api.post('/api/auth/student/login', { rollNo: roll, accessCode: code });
      setStudentToken(r.token);
      setSession({ student: r.student, exam: r.exam, results_released: r.results_released, attempt: r.attempt });
      navigate('/exam/lobby');
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };
  return (
    <div className="lobby-wrap">
      <div className="login-card" style={{ position: 'relative', zIndex: 5 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
          <div className="logo-mark"><Icon name="grad" size={19} /></div>
          <div><div className="logo-name">ExamPro</div><div className="logo-tag">Secure exam check-in</div></div>
        </div>
        {err && <div className="toast toast-err" style={{ position: 'static', transform: 'none', marginBottom: 12 }}><Icon name="alert" size={14} />{err}</div>}
        <label className="field"><span className="label">Roll number</span>
          <input className="input" value={roll} onChange={(e) => setRoll(e.target.value)} /></label>
        <label className="field"><span className="label">Exam access code</span>
          <input className="input" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} onKeyDown={(e) => e.key === 'Enter' && go()} /></label>
        <Btn kind="primary" className="btn-block btn-xl" onClick={go} disabled={busy || !roll || !code}>Check in</Btn>
        <div className="demo-box">Live exam demo: <code>STU-1001 / CARD-7291</code> · Results demo: <code>STU-1121 / ANAT-1103</code></div>
      </div>
    </div>
  );
}

/* ------------------------------- Lobby -------------------------------------- */
function Lobby() {
  const { session, setState } = useExam();
  const navigate = useNavigate();
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 1000); return () => clearInterval(t); }, []);

  const exam = session?.exam;
  const now = Date.now();
  const startsIn = Date.parse(exam.start_at) - now;
  const endsIn = Date.parse(exam.ends_at) - now;
  const open = startsIn <= 0 && endsIn > 0;

  const begin = async () => {
    setBusy(true); setErr('');
    try {
      try { await document.documentElement.requestFullscreen(); } catch { /* student can retry in room */ }
      const r = await api.post('/api/student/start');
      setState({ attempt: r.attempt, paper: r.paper, saved: r.saved, serverNow: r.server_now, violations: [] });
      navigate('/exam/room');
    } catch (e) {
      if (e.data?.attempt?.status === 'in_progress') {
        // Resume an in-progress attempt — fetch the paper
        try {
          const paper = await api.get('/api/student/paper');
          if (!paper.paper) { setErr('This exam can no longer be resumed.'); setBusy(false); return; }
          setState({ attempt: paper.attempt, paper: paper.paper, saved: paper.saved, serverNow: paper.server_now, violations: [] });
          navigate('/exam/room');
          return;
        } catch (e2) { setErr(e2.message); }
      } else setErr(e.message);
    }
    setBusy(false);
  };

  return (
    <div className="lobby-wrap">
      <Watermark name={session.student.name} roll={session.student.rollNo} />
      <div className="lobby-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#93c5fd', fontWeight: 700, fontSize: 12, letterSpacing: '.06em', marginBottom: 14 }}>
          <Icon name="shield" size={15} /> PROCTORED SESSION
        </div>
        <h2 style={{ color: '#fff', fontSize: 22, marginBottom: 2 }}>{exam.title}</h2>
        <div style={{ color: '#94a3b8', fontSize: 13, marginBottom: 18 }}>{exam.course}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 18 }}>
          {[['Duration', `${exam.duration_min} min`], ['Backtracking', exam.allow_backtracking ? 'Allowed' : 'Disabled'], ['Policy', exam.severity_policy.replace(/_/g, ' ')]].map(([k, v]) => (
            <div key={k} style={{ background: 'rgba(15,23,42,.5)', border: '1px solid rgba(148,163,184,.15)', borderRadius: 10, padding: '9px 12px' }}>
              <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.06em' }}>{k}</div>
              <div style={{ color: '#fff', fontWeight: 700, fontSize: 13, textTransform: 'capitalize' }}>{v}</div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 12.5, color: '#94a3b8', lineHeight: 1.65, marginBottom: 18 }}>
          <b style={{ color: '#cbd5e1' }}>Before you begin:</b> fullscreen is enforced; leaving the tab or window, opening dev tools, right-clicking, copying, or taking screenshots is detected and counted. Three violations (or per your instructor's policy) submit the exam automatically. Your name and roll number are watermarked across the paper.
        </div>
        {!open && startsIn > 0 && (
          <div style={{ textAlign: 'center', marginBottom: 8 }}>
            <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.08em' }}>Exam opens in</div>
            <div className="count-num">{fmtDur(startsIn)}</div>
          </div>
        )}
        {!open && endsIn <= 0 && <div className="toast toast-err" style={{ position: 'static', transform: 'none', marginBottom: 10 }}>This exam window has closed.</div>}
        {err && <div className="toast toast-err" style={{ position: 'static', transform: 'none', marginBottom: 10 }}>{err}</div>}
        {session.attempt && session.attempt.status !== 'in_progress' ? (
          <>
            <div className="toast" style={{ position: 'static', transform: 'none', marginBottom: 10 }}>You already {session.attempt.status === 'terminated' ? 'were terminated from' : 'submitted'} this exam.</div>
            <Btn kind="primary" className="btn-block btn-xl" onClick={() => navigate('/exam/results')}>Check my results</Btn>
          </>
        ) : (
          <Btn kind="primary" className="btn-block btn-xl" onClick={begin} disabled={!open || busy}>
            {busy ? 'Preparing your paper…' : session.attempt?.status === 'in_progress' ? 'Resume exam' : open ? 'Enter exam — fullscreen required' : 'Waiting for start time'}
          </Btn>
        )}
        <div style={{ textAlign: 'center', fontSize: 12, color: '#64748b', marginTop: 12 }}>
          Checked in as <b style={{ color: '#cbd5e1' }}>{session.student.name} · {session.student.rollNo}</b>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ Watermark ------------------------------------ */
function Watermark({ name, roll }) {
  const [ts, setTs] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setTs(new Date()), 60000); return () => clearInterval(t); }, []);
  const text = `${name} · ${roll} · ${ts.toLocaleDateString()} ${ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  const tiles = [];
  for (let y = 0; y < 6; y++) for (let x = 0; x < 3; x++) tiles.push({ x: x * 36 + (y % 2) * 14, y: y * 18 });
  return (
    <div className="wm-grid">
      {tiles.map((t, i) => <div key={i} className="wm-item" style={{ left: `${t.x}%`, top: `${t.y}%` }}>{text}</div>)}
    </div>
  );
}

/* ------------------------------- Exam room ----------------------------------- */
function ExamRoom() {
  const { session, state, setState } = useExam();
  const navigate = useNavigate();
  const [cur, setCur] = useState(0);
  const [answers, setAnswers] = useState(() => {
    const m = {};
    for (const s of state?.saved || []) m[s.question_id] = { selected_index: s.selected_index, essay_text: s.essay_text };
    return m;
  });
  const answersRef = useRef(answers); answersRef.current = answers;
  const dirtyRef = useRef(new Set());
  const [remaining, setRemaining] = useState(state?.attempt?.remaining_ms ?? 0);
  const serverOffsetRef = useRef(Date.parse(state?.serverNow || new Date().toISOString()) - Date.now());
  const serverNow = () => Date.now() + serverOffsetRef.current;
  const [banner, setBanner] = useState(null);
  const [needFullscreen, setNeedFullscreen] = useState(false);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const doneRef = useRef(false);
  const lastViolRef = useRef({});
  const endedAtRef = useRef(Date.parse(state.attempt.ends_at));

  const exam = session.exam;
  const paper = state.paper;
  const q = paper[cur];

  const finish = useCallback(async (isManual) => {
    if (doneRef.current) return;
    doneRef.current = true;
    try { await flushAnswers(); if (isManual) await api.post('/api/student/submit', { answers: [] }); } catch { /* server cron still cuts off */ }
    try { document.exitFullscreen?.(); } catch { /* not in fs */ }
    navigate('/exam/done');
  }, [navigate]);

  const flushAnswers = useCallback(async () => {
    const ids = [...dirtyRef.current];
    if (!ids.length || doneRef.current && !ids.length) return;
    dirtyRef.current = new Set();
    const payload = ids.map((qid) => ({ question_id: qid, ...(answersRef.current[qid] || {}) }));
    try {
      const r = await api.post('/api/student/sync', { answers: payload });
      serverOffsetRef.current = Date.parse(r.server_now) - Date.now();
    } catch (e) { /* retried on next tick */ }
  }, []);

  const reportViolation = useCallback(async (type, detail = '') => {
    if (doneRef.current) return;
    const now = Date.now();
    if (lastViolRef.current[type] && now - lastViolRef.current[type] < 4000) return; // anti-spam
    lastViolRef.current[type] = now;
    try {
      const r = await api.post('/api/student/violation', { type, detail });
      if (r.message) setBanner({ level: r.action === 'final_warning' ? 'crit' : r.action === 'terminated' ? 'crit' : 'warn', msg: r.message });
      if (r.action === 'final_warning' || r.action === 'warning') setTimeout(() => setBanner(null), 6000);
      if (r.terminated || r.action === 'terminated') finish(false);
    } catch { /* connectivity issue */ }
  }, [finish]);

  // ---- countdown (server-synced) ----
  useEffect(() => {
    const t = setInterval(() => {
      const left = endedAtRef.current - serverNow();
      setRemaining(Math.max(0, left));
      if (left <= 0) finish(false);
    }, 1000);
    return () => clearInterval(t);
  }, [finish]);

  // ---- heartbeat + periodic sync ----
  useEffect(() => {
    const t = setInterval(async () => {
      if (doneRef.current) return;
      await flushAnswers();
      try {
        const r = await api.post('/api/student/heartbeat');
        serverOffsetRef.current = Date.parse(r.server_now) - Date.now();
        if (r.expired || r.attempt.status !== 'in_progress') finish(false);
      } catch (e) {
        if (e.status === 401) { alert('Your session was replaced by another login. This tab is now closed.'); finish(false); }
      }
    }, 12000);
    return () => clearInterval(t);
  }, [flushAnswers, finish]);

  // ---- lockdown listeners (PRD 4.7) ----
  useEffect(() => {
    const onVis = () => { if (document.hidden) reportViolation('tab_blur', 'visibilitychange'); };
    const onBlur = () => reportViolation('tab_blur', 'window-blur');
    const onFs = () => {
      if (!document.fullscreenElement && !doneRef.current) {
        setNeedFullscreen(true);
        reportViolation('fullscreen_exit', 'fullscreen-exit');
      }
    };
    const onCtx = (e) => { e.preventDefault(); reportViolation('right_click', 'contextmenu'); };
    const isEditable = (t) => t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable);
    const onKey = (e) => {
      const k = e.key.toLowerCase();
      if (e.key === 'F12' || ((e.ctrlKey || e.metaKey) && e.shiftKey && ['i', 'j', 'c'].includes(k))) {
        e.preventDefault(); reportViolation('devtools', e.key);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && k === 'p') { e.preventDefault(); reportViolation('print_screen', 'ctrl+p'); return; }
      if (e.key === 'PrintScreen') { e.preventDefault(); reportViolation('print_screen', 'printscreen-key'); return; }
      if ((e.ctrlKey || e.metaKey) && ['c', 'x'].includes(k) && !isEditable(e.target)) {
        e.preventDefault(); reportViolation('copy_paste', 'keyboard-copy');
      }
    };
    const onCopy = (e) => { if (!isEditable(e.target)) { e.preventDefault(); reportViolation('copy_paste', 'copy-event'); } };
    const onBeforeUnload = (e) => { e.preventDefault(); e.returnValue = ''; };
    // back-button interception
    history.pushState(null, '', location.href);
    const onPop = () => { history.pushState(null, '', location.href); reportViolation('back_nav', 'popstate'); };

    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('blur', onBlur);
    document.addEventListener('fullscreenchange', onFs);
    document.addEventListener('contextmenu', onCtx);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('copy', onCopy, true);
    document.addEventListener('cut', onCopy, true);
    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('popstate', onPop);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('fullscreenchange', onFs);
      document.removeEventListener('contextmenu', onCtx);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('copy', onCopy, true);
      document.removeEventListener('cut', onCopy, true);
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('popstate', onPop);
    };
  }, [reportViolation]);

  const setAnswer = (qid, patch) => {
    setAnswers((a) => ({ ...a, [qid]: { ...(a[qid] || {}), ...patch } }));
    dirtyRef.current.add(qid);
  };
  const answeredCount = useMemo(
    () => paper.filter((p) => {
      const a = answers[p.question_id];
      return a && (p.type === 'mcq' ? a.selected_index != null : (a.essay_text || '').trim());
    }).length, [paper, answers]
  );
  const low = remaining < 5 * 60000;

  const reenterFs = async () => {
    try { await document.documentElement.requestFullscreen(); setNeedFullscreen(false); } catch { /* browser needs gesture — this IS the gesture */ }
  };

  return (
    <div className="exam-room">
      <Watermark name={session.student.name} roll={session.student.rollNo} />
      {banner && (
        <div className={`violation-banner ${banner.level === 'warn' ? 'warn' : ''}`}>
          <Icon name="alert" size={17} /> {banner.msg}
          {banner.level === 'warn' && <button className="link" onClick={() => setBanner(null)}>Dismiss</button>}
        </div>
      )}
      {needFullscreen && (
        <div className="modal-mask" style={{ zIndex: 100 }}>
          <div className="modal" style={{ textAlign: 'center' }}>
            <div className="modal-bd" style={{ padding: 30 }}>
              <Icon name="alert" size={34} style={{ color: '#f59e0b' }} />
              <h3 style={{ margin: '10px 0 6px' }}>Fullscreen required</h3>
              <p style={{ marginBottom: 16, fontSize: 13 }}>You left fullscreen — this was recorded. Return immediately to continue.</p>
              <Btn kind="primary" className="btn-block" onClick={reenterFs}>Return to fullscreen</Btn>
            </div>
          </div>
        </div>
      )}

      <header className="exam-top">
        <div>
          <div style={{ fontWeight: 800, color: '#fff', fontSize: 15 }}>{exam.title}</div>
          <div style={{ fontSize: 11, color: '#94a3b8' }}>{exam.course}</div>
        </div>
        <div style={{ marginLeft: 'auto' }} />
        <div style={{ fontSize: 12, color: '#94a3b8' }}>{answeredCount}/{paper.length} answered</div>
        <div className={`timer ${low ? 'low' : ''}`}><Icon name="clock" size={17} />{fmtDur(remaining)}</div>
        <Btn kind="success" onClick={() => setConfirmSubmit(true)} icon="check">Submit exam</Btn>
      </header>

      <div className="exam-body">
        <aside className="qnav">
          <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.08em' }}>Questions</div>
          <div className="qnav-grid">
            {paper.map((p, i) => {
              const a = answers[p.question_id];
              const done = a && (p.type === 'mcq' ? a.selected_index != null : (a.essay_text || '').trim());
              const locked = !exam.allow_backtracking && i < cur;
              return (
                <button key={p.question_id} disabled={locked}
                  className={`qnav-dot ${done ? 'answered' : ''} ${i === cur ? 'cur' : ''} ${locked ? 'locked' : ''}`}
                  onClick={() => setCur(i)}>{i + 1}</button>
              );
            })}
          </div>
          <div style={{ marginTop: 16, fontSize: 11.5, color: '#64748b', lineHeight: 1.6 }}>
            <span style={{ color: '#86efac' }}>●</span> answered · <span style={{ color: '#cbd5e1' }}>○</span> pending
            {!exam.allow_backtracking && <div style={{ marginTop: 6, color: '#fca5a5' }}>Backtracking is disabled — you cannot return to earlier questions.</div>}
          </div>
        </aside>

        <main className="qmain">
          <div className="q-card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 12, color: '#64748b', fontWeight: 700 }}>QUESTION {cur + 1} OF {paper.length}</span>
              <span style={{ fontSize: 11, color: '#94a3b8' }}>{q.points} pts · {q.type.toUpperCase()}</span>
            </div>
            <div className="q-text">{q.text}</div>
            {q.type === 'mcq' ? (
              q.options.map((o, oi) => (
                <div key={oi} className={`opt ${answers[q.question_id]?.selected_index === oi ? 'sel' : ''}`}
                  onClick={() => setAnswer(q.question_id, { selected_index: oi })}>
                  <span className="o-letter">{String.fromCharCode(65 + oi)}</span>
                  <span>{o.text}</span>
                </div>
              ))
            ) : (
              <>
                <textarea className="essay-box" placeholder="Type your answer here…"
                  value={answers[q.question_id]?.essay_text || ''}
                  onChange={(e) => setAnswer(q.question_id, { essay_text: e.target.value })} />
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 6 }}>
                  {(answers[q.question_id]?.essay_text || '').length} characters · AI-assisted grading (teacher confirms)
                </div>
              </>
            )}
          </div>
        </main>
      </div>

      <footer className="exam-foot">
        <Btn kind="outline" disabled={cur === 0 || !exam.allow_backtracking} onClick={() => setCur(cur - 1)} icon="chevL">Previous</Btn>
        <div style={{ flex: 1, padding: '0 12px' }}>
          <ProgressBar pct={(answeredCount / paper.length) * 100} color="#22c55e" thin />
        </div>
        <Btn kind="primary" disabled={cur === paper.length - 1} onClick={() => { flushAnswers(); setCur(cur + 1); }}>
          Next <Icon name="chevR" size={15} />
        </Btn>
      </footer>

      {confirmSubmit && (
        <div className="modal-mask" style={{ zIndex: 110 }}>
          <div className="modal">
            <div className="modal-bd" style={{ padding: '24px 24px 6px' }}>
              <h3>Submit exam?</h3>
              <p style={{ fontSize: 13, margin: '8px 0 4px' }}>You've answered <b>{answeredCount} of {paper.length}</b> questions.</p>
              <p style={{ fontSize: 12.5, color: 'var(--muted)' }}>This cannot be undone. Unanswered questions score zero.</p>
            </div>
            <footer className="modal-ft">
              <Btn kind="outline" onClick={() => setConfirmSubmit(false)}>Keep working</Btn>
              <Btn kind="danger" onClick={() => finish(true)}>Submit now</Btn>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}

/* -------------------------------- Done --------------------------------------- */
function Done() {
  const { session } = useExam();
  const navigate = useNavigate();
  return (
    <div className="lobby-wrap">
      <div className="lobby-card" style={{ textAlign: 'center' }}>
        <div className="feed-ic" style={{ width: 54, height: 54, margin: '0 auto 14px', background: 'rgba(22,163,74,.18)', color: '#4ade80' }}>
          <Icon name="check" size={26} />
        </div>
        <h2 style={{ color: '#fff', fontSize: 21 }}>Exam submitted</h2>
        <p style={{ color: '#94a3b8', fontSize: 13, margin: '8px 0 20px' }}>
          Your responses are recorded on the server. Results will appear once your instructor releases them.
        </p>
        <Btn kind="primary" className="btn-block" onClick={() => navigate('/exam/results')}>Check my results</Btn>
        <Btn kind="outline" className="btn-block" style={{ marginTop: 8, background: 'none', borderColor: 'rgba(148,163,184,.3)', color: '#cbd5e1' }}
          onClick={() => { sessionStorage.clear(); setStudentToken(''); navigate('/exam/login'); }}>Sign out</Btn>
      </div>
    </div>
  );
}

/* ------------------------------- Results ------------------------------------- */
function Results() {
  const { session } = useExam();
  const navigate = useNavigate();
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { api.get('/api/student/results').then(setD).catch((e) => setErr(e.message)); }, []);
  if (err) return <CenterMsg icon="alert" title="No attempt found" msg={err} back={() => navigate('/exam/login')} />;
  if (!d) return <div className="lobby-wrap"><Spinner /></div>;
  if (!d.released) {
    return <CenterMsg icon="clock" title="Results not released yet" msg={`Your attempted exam "${d.exam.title}" is recorded. Check back after your instructor publishes results.`} back={() => navigate('/exam/login')} />;
  }
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '30px 20px' }}>
      <div style={{ maxWidth: 780, margin: '0 auto' }}>
        <div className="card" style={{ padding: 26 }}>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>{d.exam.course}</div>
          <h1 style={{ fontSize: 20 }}>{d.exam.title}</h1>
          <div className="result-hero">
            <div style={{ marginBottom: 8 }}>
              <span className="pill" style={{ background: d.complete ? '#dcfce7' : '#fef3c7', color: d.complete ? '#15803d' : '#b45309' }}>
                {d.complete ? '✓ Final result' : '⏳ Provisional result — essay grading in progress'}
              </span>
            </div>
            <div className="result-score" style={{ color: d.pass == null ? 'var(--ink)' : d.pass ? '#15803d' : '#b91c1c' }}>{d.pct}%</div>
            <div style={{ color: 'var(--muted)', fontSize: 13 }}>
              {d.attempt.score} / {d.attempt.max_score} points
              {d.pass != null ? ` · ${d.pass ? 'PASS' : 'FAIL'} (pass mark ${d.exam.pass_pct}%)` : ' · pass/fail decided once essays are graded'}
            </div>
            <div className="break-grid">
              {d.objective?.total > 0 && (
                <div className="break-card">
                  <div className="bk-label">Multiple choice · auto-marked</div>
                  <div className="bk-val">{d.objective.score}<span> / {d.objective.max} pts</span></div>
                  <div className="bk-sub">
                    {d.objective.correct} of {d.objective.total} correct
                    {d.objective.answered < d.objective.total ? ` · ${d.objective.total - d.objective.answered} unanswered` : ''}
                  </div>
                </div>
              )}
              {d.essay?.count > 0 && (
                <div className="break-card">
                  <div className="bk-label">Essays</div>
                  <div className="bk-val">{d.essay.graded} / {d.essay.count}<span> graded</span></div>
                  <div className="bk-sub">
                    {d.essay.pending > 0 ? `${d.essay.pending} awaiting teacher review — your total will update` : `${d.essay.score} / ${d.essay.max} pts`}
                  </div>
                </div>
              )}
            </div>
            {d.violations_count > 0 && <div style={{ fontSize: 12, color: '#b45309', marginTop: 6 }}>⚑ {d.violations_count} integrity flag(s) were recorded during your session.</div>}
          </div>
          <div className="hint" style={{ textAlign: 'center', marginBottom: 10 }}>
            Per policy, you can see which questions you got right or wrong — correct answers are not disclosed so this exam can be reused.
          </div>
          {d.items.map((it) => (
            <div key={it.position} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: '1px solid var(--line-2)' }}>
              <span className={`verdict ${it.type === 'essay' ? (it.graded ? 'ok' : 'na') : it.correct == null ? 'na' : it.correct ? 'ok' : 'no'}`}>
                {it.type === 'essay' ? 'E' : it.correct ? '✓' : '✗'}
              </span>
              <span style={{ flex: 1, fontSize: 13 }}>Question {it.position} <span style={{ color: 'var(--muted)', fontSize: 11 }}>({it.type}, {it.points} pts)</span></span>
              <b style={{ fontSize: 12, color: it.type === 'essay' ? (it.graded ? '#15803d' : '#b45309') : it.correct ? '#15803d' : it.correct === false ? '#b91c1c' : 'var(--muted)' }}>
                {it.type === 'essay' ? (it.graded ? `${it.score}/${it.points}` : 'pending review') : it.correct ? 'Correct' : it.correct === false ? 'Wrong' : 'Unanswered'}
              </b>
            </div>
          ))}
        </div>
        {d.cumulative.length > 1 && (
          <div className="card" style={{ padding: 22, marginTop: 16 }}>
            <h3 style={{ marginBottom: 10 }}>Course standing — all released exams</h3>
            {d.cumulative.map((c) => (
              <div key={c.exam_id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--line-2)' }}>
                <span style={{ flex: 1 }}>{c.title}</span>
                <div style={{ width: 200 }}><ProgressBar pct={c.pct} color={c.pct >= 50 ? '#16a34a' : '#ef4444'} thin /></div>
                <b style={{ fontVariantNumeric: 'tabular-nums' }}>{c.pct}%</b>
              </div>
            ))}
          </div>
        )}
        <div style={{ textAlign: 'center', marginTop: 18 }}>
          <Btn kind="outline" onClick={() => { sessionStorage.clear(); setStudentToken(''); navigate('/exam/login'); }}>Sign out</Btn>
        </div>
      </div>
    </div>
  );
}

function CenterMsg({ icon, title, msg, back }) {
  return (
    <div className="lobby-wrap">
      <div className="lobby-card" style={{ textAlign: 'center' }}>
        <Icon name={icon} size={34} style={{ color: '#93c5fd' }} />
        <h2 style={{ color: '#fff', margin: '10px 0 6px', fontSize: 20 }}>{title}</h2>
        <p style={{ color: '#94a3b8', fontSize: 13, marginBottom: 18 }}>{msg}</p>
        <Btn kind="primary" className="btn-block" onClick={back}>Back to check-in</Btn>
      </div>
    </div>
  );
}
