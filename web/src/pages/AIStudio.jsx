import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { Card, Btn, Modal, Field, Spinner, Empty, Badge, Icon, Seg, useToast, timeAgo } from '../ui.jsx';
import { useCourses } from '../Shell.jsx';

export default function AIStudio() {
  const [params] = useSearchParams();
  const toast = useToast();
  const [tab, setTab] = useState(params.get('tab') || 'generate');
  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">AI Studio ✨</h1>
          <div className="page-sub">Gemini drafts questions and suggests essay scores from your notes — <b>nothing reaches students or grade records without your review</b>.</div>
        </div>
      </div>
      <Seg value={tab} onChange={setTab} options={[
        { value: 'generate', label: 'Generate questions' },
        { value: 'queue', label: 'Review queue' },
        { value: 'essays', label: 'Essay AI grading' },
      ]} />
      <div style={{ height: 16 }} />
      {tab === 'generate' && <GenerateTab toast={toast} />}
      {tab === 'queue' && <QueueTab toast={toast} onGotoEssays={() => setTab('essays')} />}
      {tab === 'essays' && <EssaysTab toast={toast} />}
    </div>
  );
}

/* ------------------------------- Generate ----------------------------------- */
function GenerateTab({ toast }) {
  const { courses } = useCourses();
  const [courseId, setCourseId] = useState(null);
  const [course, setCourse] = useState(null);
  const [examId, setExamId] = useState('');
  const [mcq, setMcq] = useState(8);
  const [essay, setEssay] = useState(3);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef();

  useEffect(() => { if (courses.length && !courseId) setCourseId(courses[0].id); }, [courses]);
  const loadCourse = () => courseId && api.get(`/api/courses/${courseId}`).then(setCourse);
  useEffect(() => { setCourse(null); loadCourse(); }, [courseId]);

  const upload = async (f) => {
    if (!f) return;
    const fd = new FormData(); fd.append('file', f);
    try { await api.upload(`/api/courses/${courseId}/notes`, fd); toast('Notes uploaded & text extracted'); loadCourse(); }
    catch (e) { toast(e.message, 'err'); }
  };
  const generate = async () => {
    setBusy(true);
    try {
      const r = await api.post('/api/ai/generate', { course_id: courseId, exam_id: examId || null, mcq_count: mcq, essay_count: essay });
      toast(`${r.created} items added to the review queue — approve them before they join the exam`);
    } catch (e) { toast(e.message, 'err'); }
    setBusy(false);
  };

  return (
    <div className="g-340">
      <Card title="1 · Reference notes">
        <Field label="Course">
          <select className="select" value={courseId || ''} onChange={(e) => setCourseId(Number(e.target.value))}>
            {courses.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.title}</option>)}
          </select>
        </Field>
        <Btn kind="outline" className="btn-block" icon="upload" onClick={() => fileRef.current.click()}>Upload notes (.txt/.md/.pdf)</Btn>
        <input ref={fileRef} type="file" accept=".txt,.md,.pdf,.csv" style={{ display: 'none' }} onChange={(e) => { upload(e.target.files[0]); e.target.value = ''; }} />
        <div style={{ marginTop: 10 }}>
          {!course ? <Spinner /> : course.notes.length === 0 ? <div className="hint">No notes uploaded for this course yet.</div> : course.notes.map((n) => (
            <div className="feed-item" key={n.id}>
              <div className="feed-ic" style={{ background: '#e9f0ff', color: '#2563eb' }}><Icon name="file" size={14} /></div>
              <div><b>{n.filename}</b><div style={{ fontSize: 11, color: 'var(--muted)' }}>{(n.chars / 1000).toFixed(1)}k chars</div></div>
            </div>
          ))}
        </div>
      </Card>

      <Card title="2 · Generate with Gemini">
        {course && course.notes.length === 0 ? (
          <Empty icon="file" title="Upload notes first" hint="Gemini generates questions strictly from your reference notes — no invented content." />
        ) : (
          <>
            <div className="form-grid">
              <Field label="Attach to exam (optional)" hint="Approved items will default into this exam.">
                <select className="select" value={examId} onChange={(e) => setExamId(e.target.value)}>
                  <option value="">— choose later in the review queue —</option>
                  {(course?.exams || []).filter((e) => e.status === 'scheduled').map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
                </select>
              </Field>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <Field label="MCQs to draft"><input className="input" type="number" min="0" max="30" value={mcq} onChange={(e) => setMcq(e.target.value)} /></Field>
                <Field label="Essay questions"><input className="input" type="number" min="0" max="10" value={essay} onChange={(e) => setEssay(e.target.value)} /></Field>
              </div>
            </div>
            <Btn kind="primary" icon="sparkle" onClick={generate} disabled={busy || (!mcq && !essay)}>
              {busy ? 'Gemini is drafting…' : 'Generate to review queue'}
            </Btn>
            <div className="hint" style={{ marginTop: 10 }}>
              Requires <code>GEMINI_API_KEY</code> in <code>exampro/.env</code>. Output lands in the <b>Review queue</b> tab — it never touches a live exam until you approve it.
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

/* ------------------------------ Review queue --------------------------------- */
function QueueTab({ toast, onGotoEssays }) {
  const navigate = useNavigate();
  const { courses } = useCourses();
  const [q, setQ] = useState(null);
  const [targets, setTargets] = useState({});
  const load = () => api.get('/api/ai/queue').then(setQ);
  useEffect(() => { load(); }, []);

  const act = async (id, action, extra = {}) => {
    try {
      await api.post(`/api/ai/queue/${id}/${action}`, extra);
      toast(action === 'approve' ? 'Approved into the target' : 'Rejected');
      load();
    } catch (e) { toast(e.message, 'err'); }
  };

  if (!q) return <Spinner label="Loading review queue…" />;
  const kindBadge = (k) => k === 'mcq' ? <Badge kind="info">MCQ</Badge> : k === 'essay' ? <Badge kind="violet">ESSAY</Badge> : <Badge kind="amber">RUBRIC</Badge>;

  return (
    <div className="g-300">
      <Card title={`Pending items (${q.items.length})`}>
        {q.items.length === 0 ? <Empty icon="check" title="Queue is clear" hint="Generate questions from the Generate tab." /> : q.items.map((g) => (
          <div key={g.id} style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 13, marginBottom: 10 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
              {kindBadge(g.kind)}
              <span className="hint">{g.course_code}{g.exam_title ? ` · ${g.exam_title}` : ''}{g.note_filename ? ` · from ${g.note_filename}` : ''} · {timeAgo(g.created_at)}</span>
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                <Btn kind="outline" size="sm" onClick={() => act(g.id, 'reject')}>Reject</Btn>
                {g.kind !== 'rubric' && (
                  <TargetPicker g={g} courses={courses} value={targets[g.id]} onChange={(v) => setTargets({ ...targets, [g.id]: v })} />
                )}
                <Btn kind="success" size="sm" icon="check" onClick={() => {
                  const t = targets[g.id];
                  if (g.kind !== 'rubric' && !g.exam_id && !t?.exam && !t?.bank) { toast('Pick a target exam or bank first', 'err'); return; }
                  act(g.id, 'approve', { exam_id: t?.exam || null, bank_id: t?.bank || null });
                }}>Approve</Btn>
              </span>
            </div>
            <b style={{ color: 'var(--ink)', fontSize: 13.5 }}>{g.payload.text || g.payload.question}</b>
            {g.kind === 'mcq' && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {g.payload.options.map((o, i) => (
                  <span key={i} className="pill" style={{ background: i === g.payload.correct_index ? 'var(--green-l)' : '#f1f5f9', color: i === g.payload.correct_index ? '#15803d' : 'var(--body)' }}>{o}{i === g.payload.correct_index && ' ✓'}</span>
                ))}
              </div>
            )}
            {(g.kind === 'essay' || g.kind === 'rubric') && (
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
                {g.payload.model_answer && <>Model: {g.payload.model_answer.slice(0, 160)}…<br /></>}
                {g.payload.rubric && <>Rubric: {g.payload.rubric}</>}
              </div>
            )}
          </div>
        ))}
      </Card>

      <div className="grid">
        <Card title="Also needs attention">
          <div className="queue-row">
            <div className="feed-ic" style={{ background: '#fef3c7', color: '#b45309' }}><Icon name="essay" size={14} /></div>
            <div><b>AI essay scores</b><small>confirm or override</small></div>
            <span className="q-count">{q.essay_pending}</span>
          </div>
          <div className="queue-row">
            <div className="feed-ic" style={{ background: '#fee2e2', color: '#b91c1c' }}><Icon name="alert" size={14} /></div>
            <div><b>Flagged questions</b><small>quality alerts</small></div>
            <span className="q-count">{q.flagged}</span>
          </div>
          {q.essay_pending > 0 && <Btn kind="outline" className="btn-block" style={{ marginTop: 8 }} onClick={onGotoEssays}>Review essay grading →</Btn>}
        </Card>
        <Card title="Human-in-the-loop">
          <div style={{ fontSize: 12.5, lineHeight: 1.6 }}>
            Every approval writes to the audit log. Rejected items are kept for your records but never used. Published questions show an <Badge kind="new">AI</Badge> badge in the exam builder.
          </div>
        </Card>
      </div>
    </div>
  );
}

function TargetPicker({ g, courses, value, onChange }) {
  const course = courses.find((c) => c.code === g.course_code);
  const [detail, setDetail] = useState(null);
  useEffect(() => {
    if (course) api.get(`/api/courses/${course.id}`).then(setDetail).catch(() => setDetail(null));
  }, [g.id]);
  const exams = (detail?.exams || []).filter((e) => e.status === 'scheduled');
  const banks = detail?.banks || [];
  return (
    <select className="select" style={{ width: 190, padding: '5px 9px', fontSize: 12 }}
      value={value?.exam ? `exam:${value.exam}` : value?.bank ? `bank:${value.bank}` : g.exam_id ? `exam:${g.exam_id}` : ''}
      onChange={(e) => {
        const v = e.target.value;
        onChange(v.startsWith('exam:') ? { exam: Number(v.slice(5)) } : v.startsWith('bank:') ? { bank: Number(v.slice(5)) } : null);
      }}>
      <option value="">Target exam/bank…</option>
      <optgroup label="Exams">
        {exams.map((e) => <option key={e.id} value={`exam:${e.id}`}>{e.title}</option>)}
      </optgroup>
      <optgroup label="Banks">
        {banks.map((b) => <option key={b.id} value={`bank:${b.id}`}>{b.name}</option>)}
      </optgroup>
    </select>
  );
}

/* ------------------------------ Essay grading -------------------------------- */
function EssaysTab({ toast }) {
  const [exams, setExams] = useState(null);
  const [examId, setExamId] = useState(null);
  const [data, setData] = useState(null);
  const [scores, setScores] = useState({});

  useEffect(() => {
    api.get('/api/exams').then((all) => {
      const withEssays = all.filter((e) => e.participants > 0);
      setExams(withEssays);
    });
  }, []);
  const load = () => examId && api.get(`/api/exams/${examId}/grading`).then(setData);
  useEffect(() => { setData(null); load(); }, [examId]);

  const grade = async (answerId, score, maxPts) => {
    try {
      const r = await api.post(`/api/answers/${answerId}/grade`, { score: Number(score) });
      toast(r.status === 'overridden' ? 'Override saved (audit-logged)' : 'Score confirmed');
      load();
    } catch (e) { toast(e.message, 'err'); }
  };
  const runAi = async () => {
    try {
      const r = await api.post(`/api/exams/${examId}/ai-grade`);
      toast(r.queued ? `Gemini is grading ${r.queued} essays — refresh in a moment` : 'Nothing to grade');
      if (r.queued) setTimeout(load, 6000);
    } catch (e) { toast(e.message, 'err'); }
  };

  return (
    <div>
      <Card pad={false} className="stat-card">
        <div className="stat" style={{ gap: 12, flexWrap: 'wrap' }}>
          <Field label="Exam">
            <select className="select" style={{ minWidth: 320 }} value={examId || ''} onChange={(e) => setExamId(Number(e.target.value))}>
              <option value="">Select exam…</option>
              {(exams || []).map((e) => <option key={e.id} value={e.id}>{e.course?.code} · {e.title}</option>)}
            </select>
          </Field>
          {data && (
            <>
              <div style={{ marginLeft: 'auto' }} />
              <Badge kind="amber">{data.pending} awaiting review</Badge>
              {data.exam.ai_grading_enabled && <Btn kind="outline" size="sm" icon="sparkle" onClick={runAi}>Run/refresh Gemini grading</Btn>}
            </>
          )}
        </div>
      </Card>
      <div style={{ height: 14 }} />

      {!examId ? <Card><Empty icon="essay" title="Pick an exam to review essay answers" /></Card>
        : !data ? <Spinner />
        : data.rows.length === 0 ? <Card><Empty icon="essay" title="No essay questions in this exam" /></Card>
        : data.rows.map((r) => (
          <Card key={r.answer_id} style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
              <Badge kind="violet">ESSAY</Badge>
              <b style={{ color: 'var(--ink)', flex: 1 }}>{r.question_text}</b>
              <Badge kind="muted">{r.points} pts</Badge>
              {r.grading_status === 'ai_pending' && <Badge kind="amber">AI suggestion pending</Badge>}
              {r.grading_status === 'confirmed' && r.final_score != null && <Badge kind="success">Confirmed {r.grader_name ? `by ${r.grader_name}` : ''}</Badge>}
              {r.grading_status === 'overridden' && <Badge kind="info">Overridden by {r.grader_name || 'teacher'}</Badge>}
            </div>
            <div className="g-r2">
              <div>
                <div className="label" style={{ marginBottom: 4 }}>{r.student_name} <span style={{ color: 'var(--muted)' }}>({r.roll_no})</span></div>
                <div style={{ background: '#f8fafc', border: '1px solid var(--line)', borderRadius: 10, padding: 11, fontSize: 12.5, minHeight: 88, whiteSpace: 'pre-wrap' }}>
                  {r.essay_text?.trim() || <em style={{ color: 'var(--muted)' }}>No answer submitted</em>}
                </div>
              </div>
              <div>
                <div className="label" style={{ marginBottom: 4 }}>Model answer</div>
                <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: 11, fontSize: 12.5, minHeight: 88 }}>{r.model_answer || '—'}</div>
              </div>
            </div>
            {r.ai_score != null && (
              <div style={{ background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 10, padding: 10, marginTop: 10, fontSize: 12.5 }}>
                <b>Gemini suggests {r.ai_score}/{r.points}</b> — {r.ai_rationale}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
              <input className="input" type="number" min="0" max={r.points} step="0.5" style={{ width: 110 }}
                value={scores[r.answer_id] ?? (r.final_score ?? r.ai_score ?? '')}
                onChange={(e) => setScores({ ...scores, [r.answer_id]: e.target.value })} />
              <span className="hint">/ {r.points}</span>
              {r.ai_score != null && <Btn kind="outline" size="sm" onClick={() => grade(r.answer_id, r.ai_score)}>Accept AI ({r.ai_score})</Btn>}
              <Btn kind="primary" size="sm" onClick={() => grade(r.answer_id, scores[r.answer_id] ?? r.ai_score ?? 0)}>Save final score</Btn>
              <span className="hint" style={{ marginLeft: 'auto' }}>Changing an AI score logs an override with timestamp &amp; teacher ID.</span>
            </div>
          </Card>
        ))}
    </div>
  );
}
