import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import {
  Card, Btn, Modal, Field, Spinner, Empty, Badge, Icon, Seg, useToast,
  statusBadge, fmtDate, fmtTime, fmtDateTime,
} from '../ui.jsx';
import { useCourses } from '../Shell.jsx';

export function ExamForm({ open, onClose, onSaved, presetCourseId }) {
  const toast = useToast();
  const { courses } = useCourses();
  const [banks, setBanks] = useState([]);
  const [busy, setBusy] = useState(false);
  const now = new Date(Date.now() + 3600e3);
  now.setMinutes(0, 0, 0);
  const localIso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const [f, setF] = useState(null);

  useEffect(() => {
    if (!open) return;
    setF({
      course_id: presetCourseId || courses[0]?.id || '', title: '', description: '',
      start_at: localIso(now), duration_min: 60, access_code: '',
      shuffle_questions: true, shuffle_options: true, allow_backtracking: true,
      question_source: 'custom', bank_id: '', question_count: '',
      severity_policy: 'warn_limit', ai_grading_enabled: false,
      use_roster_override: false, pass_pct: 50,
    });
  }, [open, presetCourseId, courses]);

  useEffect(() => {
    if (!f?.course_id) return;
    api.get(`/api/courses/${f.course_id}/banks`).then(setBanks).catch(() => setBanks([]));
  }, [f?.course_id]);

  if (!open || !f) return null;
  const save = async () => {
    setBusy(true);
    try {
      const payload = {
        ...f,
        start_at: new Date(f.start_at).toISOString(),
        duration_min: Number(f.duration_min),
        bank_id: f.question_source === 'bank' ? Number(f.bank_id) : null,
        question_count: f.question_count ? Number(f.question_count) : null,
        access_code: f.access_code || undefined,
      };
      const ex = await api.post('/api/exams', payload);
      toast(`Exam created — access code ${ex.access_code}`);
      onSaved(ex); onClose();
    } catch (e) { toast(e.message, 'err'); }
    setBusy(false);
  };

  const endPreview = f.start_at && f.duration_min
    ? new Date(new Date(f.start_at).getTime() + Number(f.duration_min || 0) * 60000)
    : null;

  return (
    <Modal open={open} onClose={onClose} title="Create Exam" wide
      footer={<>
        <Btn kind="outline" onClick={onClose}>Cancel</Btn>
        <Btn kind="primary" onClick={save} disabled={busy || !f.title || !f.course_id || (f.question_source === 'bank' && !f.bank_id)}>
          {busy ? 'Creating…' : 'Create Exam'}
        </Btn>
      </>}>
      <div className="form-grid">
        <Field label="Course">
          <select className="select" value={f.course_id} onChange={(e) => setF({ ...f, course_id: Number(e.target.value) })}>
            {courses.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.title} ({c.term})</option>)}
          </select>
        </Field>
        <Field label="Exam title"><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Midterm Exam" /></Field>
        <Field label="Description" hint="Shown to students in the lobby.">
          <input className="input full" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Covers weeks 1–8" />
        </Field>

        <Field label="Start time">
          <input className="input" type="datetime-local" value={f.start_at} onChange={(e) => setF({ ...f, start_at: e.target.value })} />
        </Field>
        <Field label="Duration (minutes)"
          hint={endPreview ? `Fixed end for EVERYONE: ${endPreview.toLocaleString()} — a student entering late simply gets less time.` : ''}>
          <input className="input" type="number" min="1" max="1440" value={f.duration_min} onChange={(e) => setF({ ...f, duration_min: e.target.value })} />
        </Field>

        <Field label="Access code" hint="Leave blank to auto-generate. Students log in with roll number + this code.">
          <input className="input" value={f.access_code} onChange={(e) => setF({ ...f, access_code: e.target.value.toUpperCase() })} placeholder="AUTO" />
        </Field>
        <Field label="Pass mark (%)">
          <input className="input" type="number" min="1" max="100" value={f.pass_pct} onChange={(e) => setF({ ...f, pass_pct: e.target.value })} />
        </Field>

        <Field label="Question source">
          <select className="select" value={f.question_source} onChange={(e) => setF({ ...f, question_source: e.target.value })}>
            <option value="custom">Build questions for this exam (or AI-generate)</option>
            <option value="bank">Draw from a question bank</option>
          </select>
        </Field>
        {f.question_source === 'bank' && (
          <>
            <Field label="Question bank">
              <select className="select" value={f.bank_id} onChange={(e) => setF({ ...f, bank_id: e.target.value })}>
                <option value="">Select bank…</option>
                {banks.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.questions} questions)</option>)}
              </select>
            </Field>
            <Field label="Draw N random questions per student" hint="Each student gets a distinct subset of the pool.">
              <input className="input" type="number" min="1" value={f.question_count} onChange={(e) => setF({ ...f, question_count: e.target.value })} placeholder="e.g. 10" />
            </Field>
          </>
        )}

        <Field label="Violation policy (anti-cheating)">
          <select className="select" value={f.severity_policy} onChange={(e) => setF({ ...f, severity_policy: e.target.value })}>
            <option value="warn_limit">3-strike: flag → final warning → auto-submit (default)</option>
            <option value="warn">Warn only: record violations, never terminate</option>
            <option value="zero_tolerance">Zero tolerance: any violation ends the exam</option>
          </select>
        </Field>
        <div>
          <label className="check-row"><input type="checkbox" checked={f.shuffle_questions} onChange={(e) => setF({ ...f, shuffle_questions: e.target.checked })} /><span><b>Shuffle questions</b> — per-student order</span></label>
          <label className="check-row"><input type="checkbox" checked={f.shuffle_options} onChange={(e) => setF({ ...f, shuffle_options: e.target.checked })} /><span><b>Shuffle answer options</b> — per-student MCQ order</span></label>
          <label className="check-row"><input type="checkbox" checked={f.allow_backtracking} onChange={(e) => setF({ ...f, allow_backtracking: e.target.checked })} /><span><b>Allow backtracking</b> — students may revisit earlier questions</span></label>
          <label className="check-row"><input type="checkbox" checked={f.ai_grading_enabled} onChange={(e) => setF({ ...f, ai_grading_enabled: e.target.checked })} /><span><b>AI essay grading</b> — Gemini suggests scores; teacher confirms (human-in-the-loop)</span></label>
          <label className="check-row"><input type="checkbox" checked={f.use_roster_override} onChange={(e) => setF({ ...f, use_roster_override: e.target.checked })} /><span><b>Override roster</b> — use a custom roster for this exam only (make-up exam / guest cohort)</span></label>
        </div>
      </div>
    </Modal>
  );
}

export default function Exams() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [exams, setExams] = useState(null);
  const [filter, setFilter] = useState('all');
  const [showNew, setShowNew] = useState(false);
  const q = params.get('q') || '';

  const load = () => api.get('/api/exams').then(setExams).catch(() => {});
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (params.get('new') === '1') setShowNew(true);
  }, [params]);

  const filtered = useMemo(() => {
    if (!exams) return [];
    let out = exams;
    if (filter !== 'all') out = out.filter((e) => e.status === filter);
    if (q) out = out.filter((e) => `${e.title} ${e.course?.code} ${e.access_code}`.toLowerCase().includes(q.toLowerCase()));
    return out;
  }, [exams, filter, q]);

  if (!exams) return <Spinner label="Loading exams…" />;
  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Exams</h1>
          <div className="page-sub">{exams.length} exams across your courses.</div>
        </div>
        <div className="page-actions">
          <Seg value={filter} onChange={setFilter} options={[
            { value: 'all', label: 'All' }, { value: 'live', label: 'Live' },
            { value: 'scheduled', label: 'Scheduled' }, { value: 'ended', label: 'Ended' },
          ]} />
          <Btn kind="primary" icon="plus" onClick={() => setShowNew(true)}>Create Exam</Btn>
        </div>
      </div>

      <Card pad={false}>
        {filtered.length === 0 ? <Empty icon="exams" title="No exams match" hint="Try a different filter or create a new exam."
          action={<Btn kind="primary" icon="plus" onClick={() => setShowNew(true)}>Create Exam</Btn>} /> : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Exam</th><th>Course</th><th>Window</th><th>Access Code</th><th>Status</th><th>Students</th><th>Flagged</th></tr></thead>
              <tbody>
                {filtered.map((e) => (
                  <tr key={e.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/exams/${e.id}`)}>
                    <td className="t-strong">{e.title}</td>
                    <td>{e.course?.code} <span style={{ color: 'var(--muted)', fontSize: 11 }}>· {e.course?.term}</span></td>
                    <td>{fmtDateTime(e.start_at)}<div style={{ fontSize: 11, color: 'var(--muted)' }}>{e.duration_min} min → ends {fmtTime(e.ends_at)}</div></td>
                    <td><code style={{ background: '#f1f5f9', padding: '2px 7px', borderRadius: 6, fontSize: 11.5 }}>{e.access_code}</code></td>
                    <td>{statusBadge(e.status)}</td>
                    <td>{e.status === 'live' ? <b style={{ color: '#15803d' }}>{e.live_participants} online</b> : e.participants}</td>
                    <td>{e.flagged > 0 ? <Badge kind="warn">{e.flagged} flagged</Badge> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ExamForm open={showNew} onClose={() => { setShowNew(false); if (params.get('new')) { params.delete('new'); setParams(params, { replace: true }); } }}
        presetCourseId={params.get('course') ? Number(params.get('course')) : null}
        onSaved={(ex) => navigate(`/exams/${ex.id}`)} />
    </div>
  );
}
