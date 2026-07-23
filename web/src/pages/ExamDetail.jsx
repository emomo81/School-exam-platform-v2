import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../api.js';
import {
  Card, Btn, Modal, Field, Spinner, Empty, Badge, Icon, Seg, useToast,
  statusBadge, fmtDateTime, fmtTime,
} from '../ui.jsx';

export default function ExamDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [exam, setExam] = useState(null);
  const [tab, setTab] = useState('questions');
  const load = () => api.get(`/api/exams/${id}`).then(setExam).catch((e) => toast(e.message, 'err'));
  useEffect(() => { setExam(null); load(); }, [id]);

  if (!exam) return <Spinner label="Loading exam…" />;
  const locked = exam.participants > 0;
  const canEdit = exam.role !== 'ta';

  const action = async (fn, msg) => { try { await fn(); msg && toast(msg); load(); } catch (e) { toast(e.message, 'err'); } };

  return (
    <div>
      <div className="page-head">
        <div>
          <Link to="/exams" className="link" style={{ fontSize: 12 }}>← Exams</Link>
          <h1 className="page-title" style={{ marginTop: 4 }}>{exam.title}</h1>
          <div className="page-sub">
            {exam.course.code} — {exam.course.title} · {fmtDateTime(exam.start_at)} · {exam.duration_min} min (ends {fmtTime(exam.ends_at)}) &nbsp;
            {statusBadge(exam.status)} &nbsp;
            <code style={{ background: '#f1f5f9', padding: '2px 8px', borderRadius: 6, fontSize: 11.5 }}>{exam.access_code}</code>
            <button className="link" style={{ marginLeft: 6 }} onClick={() => { navigator.clipboard?.writeText(exam.access_code); toast('Access code copied'); }}>copy</button>
          </div>
        </div>
        <div className="page-actions">
          {exam.status === 'live' && <Btn kind="outline" icon="monitor" onClick={() => navigate(`/monitoring/${exam.id}`)}>Live Monitor</Btn>}
          {(exam.status === 'ended' || exam.participants > 0) && <Btn kind="outline" icon="chart" onClick={() => navigate(`/results/${exam.id}`)}>Analytics</Btn>}
          {exam.status === 'live' && canEdit && <Btn kind="danger" onClick={() => confirm('Force-close now? All in-progress attempts auto-submit.') && action(() => api.post(`/api/exams/${exam.id}/close`), 'Exam closed')}>Force Close</Btn>}
          {!exam.results_released && exam.status === 'ended' && <Btn kind="success" icon="check" onClick={() => action(() => api.post(`/api/exams/${exam.id}/release`), 'Results released to students')}>Release Results</Btn>}
          {exam.results_released && <Btn kind="outline" onClick={() => action(() => api.post(`/api/exams/${exam.id}/unrelease`), 'Results hidden')}>Un-release</Btn>}
        </div>
      </div>

      <div className="stat-row-5">
        {[
          ['Students (roster)', exam.use_roster_override ? 'override' : exam.participants + (exam.status === 'scheduled' ? ` of roster` : '')],
          ['Questions', exam.questions],
          ['Participants', exam.participants],
          ['Online now', exam.live_participants],
          ['Flagged', exam.flagged],
        ].map(([l, v]) => (
          <Card key={l} pad={false}><div className="stat"><div><div className="stat-num" style={{ fontSize: 19 }}>{v ?? 0}</div><div className="stat-sub">{l}</div></div></div></Card>
        ))}
      </div>

      <Seg value={tab} onChange={setTab} options={[
        { value: 'questions', label: 'Questions' },
        { value: 'preview', label: 'Preview' },
        { value: 'roster', label: 'Roster Override' },
        { value: 'settings', label: 'Settings' },
      ]} />
      <div style={{ height: 16 }} />
      {tab === 'questions' && <QuestionsTab exam={exam} reload={load} toast={toast} locked={locked} canEdit={canEdit} />}
      {tab === 'preview' && <PreviewTab exam={exam} />}
      {tab === 'roster' && <RosterTab exam={exam} reload={load} toast={toast} canEdit={canEdit} />}
      {tab === 'settings' && <SettingsTab exam={exam} reload={load} toast={toast} locked={locked} canEdit={canEdit} />}
    </div>
  );
}

/* ------------------------------ Questions tab -------------------------------- */
function QuestionsTab({ exam, reload, toast, locked, canEdit }) {
  const [qs, setQs] = useState(null);
  const [showQ, setShowQ] = useState(false);
  const [editQ, setEditQ] = useState(null);
  const load = () => api.get(`/api/exams/${exam.id}/questions`).then(setQs);
  useEffect(() => { load(); }, [exam.id]);

  const del = async (qid) => {
    if (!confirm('Delete this question?')) return;
    try { await api.del(`/api/questions/${qid}`); load(); } catch (e) { toast(e.message, 'err'); }
  };
  const flag = async (qid) => { await api.post(`/api/questions/${qid}/flag`); load(); };

  if (!qs) return <Spinner />;
  const bankMode = exam.question_source === 'bank';
  const total = qs.reduce((s, x) => s + x.points, 0);
  return (
    <Card
      title={bankMode ? `Bank questions (draw ${exam.question_count || 'all'} per student)` : `Questions (${qs.length}) · ${total} pts total`}
      action={canEdit && !bankMode && !locked && <Btn kind="primary" size="sm" icon="plus" onClick={() => { setEditQ(null); setShowQ(true); }}>Add question</Btn>}>
      {locked && <div className="hint" style={{ marginBottom: 10 }}>🔒 Questions are locked because attempts exist. The exam content can no longer change.</div>}
      {bankMode && <div className="hint" style={{ marginBottom: 10 }}>This exam draws from a question bank. Edit the pool under Question Bank.</div>}
      {qs.length === 0 ? (
        <Empty icon="bank" title="No questions yet" hint="Add questions manually, or use AI Studio to generate them from your notes."
          action={canEdit && !locked && <Btn kind="primary" icon="plus" onClick={() => { setEditQ(null); setShowQ(true); }}>Add first question</Btn>} />
      ) : (
        qs.map((x, i) => (
          <div key={x.id} style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 13, marginBottom: 10, background: x.flagged ? '#fffbeb' : '#fff' }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <b style={{ color: 'var(--muted)', fontSize: 12 }}>Q{i + 1}</b>
              <div style={{ flex: 1 }}>
                <div style={{ color: 'var(--ink)', fontWeight: 600 }}>{x.text}</div>
                {x.type === 'mcq' && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                    {x.options.map((o, oi) => (
                      <span key={oi} className="pill" style={{ background: oi === x.correct_index ? 'var(--green-l)' : '#f1f5f9', color: oi === x.correct_index ? '#15803d' : 'var(--body)' }}>
                        {String.fromCharCode(65 + oi)}. {o} {oi === x.correct_index && '✓'}
                      </span>
                    ))}
                  </div>
                )}
                {x.type === 'essay' && x.model_answer && <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 6 }}>Model answer: {x.model_answer.slice(0, 140)}{x.model_answer.length > 140 ? '…' : ''}</div>}
              </div>
              <Badge kind={x.type === 'mcq' ? 'info' : 'violet'}>{x.type.toUpperCase()}</Badge>
              <Badge kind="muted">{x.points} pts</Badge>
              {x.source === 'ai' && <Badge kind="new">AI</Badge>}
              {x.flagged && <Badge kind="warn">Review flagged</Badge>}
              {canEdit && !locked && (
                <span style={{ display: 'flex', gap: 2 }}>
                  <button className="icon-btn" title="Edit" onClick={() => { setEditQ(x); setShowQ(true); }}><Icon name="edit" size={14} /></button>
                  <button className="icon-btn" title={x.flagged ? 'Unflag' : 'Flag for review'} onClick={() => flag(x.id)}><Icon name="flag" size={14} /></button>
                  {!bankMode && <button className="icon-btn" title="Delete" onClick={() => del(x.id)}><Icon name="trash" size={14} /></button>}
                </span>
              )}
            </div>
          </div>
        ))
      )}
      <QuestionForm open={showQ} onClose={() => setShowQ(false)} examId={exam.id} q={editQ}
        onSaved={() => { setShowQ(false); load(); }} toast={toast} />
    </Card>
  );
}

export function QuestionForm({ open, onClose, examId, bankId, q, onSaved, toast }) {
  const empty = { type: 'mcq', text: '', options: ['', '', '', ''], correct_index: 0, points: 2, model_answer: '' };
  const [f, setF] = useState(empty);
  useEffect(() => {
    if (!open) return;
    setF(q ? { type: q.type, text: q.text, options: q.options || ['', ''], correct_index: q.correct_index ?? 0, points: q.points, model_answer: q.model_answer || '' } : empty);
  }, [open, q]);

  const setOpt = (i, v) => setF({ ...f, options: f.options.map((o, oi) => (oi === i ? v : o)) });
  const save = async () => {
    try {
      const payload = { ...f, options: f.type === 'mcq' ? f.options.filter((o) => o.trim()) : undefined };
      if (q) await api.patch(`/api/questions/${q.id}`, payload);
      else if (bankId) await api.post(`/api/banks/${bankId}/questions`, payload);
      else await api.post(`/api/exams/${examId}/questions`, payload);
      toast(q ? 'Question updated' : 'Question added');
      onSaved();
    } catch (e) { toast(e.message, 'err'); }
  };
  return (
    <Modal open={open} onClose={onClose} title={q ? 'Edit question' : 'Add question'}
      footer={<><Btn kind="outline" onClick={onClose}>Cancel</Btn>
        <Btn kind="primary" onClick={save} disabled={!f.text.trim() || (f.type === 'mcq' && f.options.filter((o) => o.trim()).length < 2)}>Save question</Btn></>}>
      <div className="form-grid">
        <Field label="Type">
          <select className="select" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
            <option value="mcq">Multiple choice</option>
            <option value="essay">Essay (manual / AI-assisted grading)</option>
          </select>
        </Field>
        <Field label="Points"><input className="input" type="number" min="0.5" step="0.5" value={f.points} onChange={(e) => setF({ ...f, points: e.target.value })} /></Field>
        <Field label="Question text"><textarea className="textarea full" rows={3} value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} /></Field>
      </div>
      {f.type === 'mcq' && (
        <>
          <Field label="Options — select the correct one">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {f.options.map((o, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input type="radio" name="correct" checked={f.correct_index === i} onChange={() => setF({ ...f, correct_index: i })} style={{ accentColor: '#16a34a', width: 16, height: 16 }} />
                  <input className="input" value={o} onChange={(e) => setOpt(i, e.target.value)} placeholder={`Option ${String.fromCharCode(65 + i)}`} />
                  {f.options.length > 2 && <button className="icon-btn" onClick={() => setF({ ...f, options: f.options.filter((_, oi) => oi !== i), correct_index: Math.max(0, f.correct_index > i ? f.correct_index - 1 : f.correct_index) })}><Icon name="x" size={14} /></button>}
                </div>
              ))}
            </div>
          </Field>
          {f.options.length < 6 && <Btn kind="outline" size="sm" icon="plus" onClick={() => setF({ ...f, options: [...f.options, ''] })}>Add option</Btn>}
        </>
      )}
      {f.type === 'essay' && (
        <Field label="Model answer" hint="Used by Gemini for AI grading suggestions and by you during review.">
          <textarea className="textarea" rows={4} value={f.model_answer} onChange={(e) => setF({ ...f, model_answer: e.target.value })} />
        </Field>
      )}
    </Modal>
  );
}

/* ------------------------------- Preview tab -------------------------------- */
function PreviewTab({ exam }) {
  const [paper, setPaper] = useState(null);
  useEffect(() => { api.get(`/api/exams/${exam.id}/paper`).then(setPaper); }, [exam.id]);
  if (!paper) return <Spinner />;
  if (!paper.length) return <Card><Empty icon="eye" title="Nothing to preview yet" /></Card>;
  return (
    <Card title="Teacher preview — includes correct answers (never shown to students)">
      {paper.map((q) => (
        <div key={q.question_id} style={{ borderBottom: '1px solid var(--line-2)', padding: '12px 0' }}>
          <b style={{ color: 'var(--ink)' }}>Q{q.position + 1}.</b> <span style={{ color: 'var(--ink)' }}>{q.text}</span>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
            {q.type === 'mcq'
              ? q.options.map((o) => <div key={o.index} style={{ color: o.index === q.correct_index ? '#15803d' : 'inherit' }}>{o.index === q.correct_index ? '✓' : '·'} {o.text}</div>)
              : <em>Model: {q.model_answer || '—'}</em>}
          </div>
        </div>
      ))}
    </Card>
  );
}

/* ---------------------------- Roster override tab ---------------------------- */
function RosterTab({ exam, reload, toast, canEdit }) {
  const [rows, setRows] = useState(null);
  const [roll, setRoll] = useState('');
  const [name, setName] = useState('');
  const load = () => api.get(`/api/exams/${exam.id}/roster-override`).then(setRows);
  useEffect(() => { load(); }, [exam.id]);

  const toggle = async () => {
    try { await api.patch(`/api/exams/${exam.id}`, { use_roster_override: !exam.use_roster_override }); reload(); }
    catch (e) { toast(e.message, 'err'); }
  };
  const add = async () => {
    try { await api.post(`/api/exams/${exam.id}/roster-override`, { roll_no: roll, name }); setRoll(''); setName(''); load(); toast('Added to override roster'); }
    catch (e) { toast(e.message, 'err'); }
  };
  const remove = async (sid) => { await api.del(`/api/exams/${exam.id}/roster-override/${sid}`); load(); };

  if (!rows) return <Spinner />;
  return (
    <Card title="Exam-level roster override"
      action={canEdit && <Btn kind={exam.use_roster_override ? 'outline' : 'primary'} size="sm" onClick={toggle}>
        {exam.use_roster_override ? 'Disable override (use course roster)' : 'Enable override roster'}
      </Btn>}>
      <div className="hint" style={{ marginBottom: 10 }}>
        {exam.use_roster_override
          ? <b style={{ color: '#6d28d9' }}>Override active: ONLY the {rows.length} students below can enter this exam (the course roster is ignored).</b>
          : 'By default, every student on the course roster can enter this exam. Enable the override for make-up exams or guest cohorts.'}
      </div>
      {exam.use_roster_override && (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <input className="input" style={{ width: 160 }} placeholder="Roll no" value={roll} onChange={(e) => setRoll(e.target.value)} />
            <input className="input" style={{ flex: 1 }} placeholder="Name (for new students)" value={name} onChange={(e) => setName(e.target.value)} />
            <Btn kind="primary" size="sm" onClick={add} disabled={!roll.trim()}>Add</Btn>
          </div>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Roll No</th><th>Name</th><th>Email</th><th></th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}><td className="t-strong">{r.roll_no}</td><td>{r.name}</td><td>{r.email || '—'}</td>
                    <td>{canEdit && <button className="icon-btn" onClick={() => remove(r.id)}><Icon name="trash" size={14} /></button>}</td></tr>
                ))}
                {!rows.length && <tr><td colSpan="4" style={{ color: 'var(--muted)' }}>Override roster is empty — nobody can enter until you add students.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}

/* ------------------------------ Settings tab -------------------------------- */
function SettingsTab({ exam, reload, toast, locked, canEdit }) {
  const localIso = (iso) => { const d = new Date(iso); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
  const [f, setF] = useState(() => ({ ...exam, start_at: localIso(exam.start_at) }));
  useEffect(() => setF({ ...exam, start_at: localIso(exam.start_at) }), [exam]);
  const save = async () => {
    try {
      await api.patch(`/api/exams/${exam.id}`, {
        title: f.title, description: f.description,
        start_at: locked ? undefined : new Date(f.start_at).toISOString(),
        duration_min: locked ? undefined : Number(f.duration_min),
        shuffle_questions: !!f.shuffle_questions, shuffle_options: !!f.shuffle_options,
        allow_backtracking: !!f.allow_backtracking, severity_policy: f.severity_policy,
        ai_grading_enabled: !!f.ai_grading_enabled, pass_pct: Number(f.pass_pct),
      });
      toast('Settings saved'); reload();
    } catch (e) { toast(e.message, 'err'); }
  };
  return (
    <Card title="Exam settings">
      {!canEdit && <div className="hint" style={{ marginBottom: 8 }}>You have a TA role on this course — settings are read-only.</div>}
      <div className="form-grid">
        <Field label="Title"><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} disabled={!canEdit} /></Field>
        <Field label="Pass %"><input className="input" type="number" value={f.pass_pct} onChange={(e) => setF({ ...f, pass_pct: e.target.value })} disabled={!canEdit} /></Field>
        <Field label={locked ? 'Start (locked — attempts exist)' : 'Start'}>
          <input className="input" type="datetime-local" value={f.start_at} onChange={(e) => setF({ ...f, start_at: e.target.value })} disabled={!canEdit || locked} />
        </Field>
        <Field label={locked ? 'Duration (locked)' : 'Duration (min)'}>
          <input className="input" type="number" value={f.duration_min} onChange={(e) => setF({ ...f, duration_min: e.target.value })} disabled={!canEdit || locked} />
        </Field>
        <Field label="Description"><input className="input full" value={f.description || ''} onChange={(e) => setF({ ...f, description: e.target.value })} disabled={!canEdit} /></Field>
        <Field label="Violation policy" hint="Applied at the moment the violation occurs.">
          <select className="select" value={f.severity_policy} onChange={(e) => setF({ ...f, severity_policy: e.target.value })} disabled={!canEdit}>
            <option value="warn_limit">3-strike escalation (default)</option>
            <option value="warn">Warn only</option>
            <option value="zero_tolerance">Zero tolerance</option>
          </select>
        </Field>
        <div>
          <label className="check-row"><input disabled={!canEdit} type="checkbox" checked={!!f.shuffle_questions} onChange={(e) => setF({ ...f, shuffle_questions: e.target.checked })} /><span><b>Shuffle questions</b></span></label>
          <label className="check-row"><input disabled={!canEdit} type="checkbox" checked={!!f.shuffle_options} onChange={(e) => setF({ ...f, shuffle_options: e.target.checked })} /><span><b>Shuffle options</b></span></label>
          <label className="check-row"><input disabled={!canEdit} type="checkbox" checked={!!f.allow_backtracking} onChange={(e) => setF({ ...f, allow_backtracking: e.target.checked })} /><span><b>Allow backtracking</b></span></label>
          <label className="check-row"><input disabled={!canEdit} type="checkbox" checked={!!f.ai_grading_enabled} onChange={(e) => setF({ ...f, ai_grading_enabled: e.target.checked })} /><span><b>AI essay grading</b> (teacher confirms every suggestion)</span></label>
        </div>
      </div>
      {canEdit && <Btn kind="primary" onClick={save}>Save settings</Btn>}
    </Card>
  );
}
