import React, { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../api.js';
import {
  Card, Btn, Modal, Field, Spinner, Empty, Badge, Icon, Seg, useToast,
  statusBadge, fmtDate, fmtTime, fmtDateTime, Ring,
} from '../ui.jsx';
import { useCourses } from '../Shell.jsx';

export default function CourseDetail() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { refresh } = useCourses();
  const [c, setC] = useState(null);
  const [tab, setTab] = useState(params.get('tab') || 'exams');

  const load = () => api.get(`/api/courses/${id}`).then(setC).catch((e) => toast(e.message, 'err'));
  useEffect(() => { setC(null); load(); }, [id]);

  if (!c) return <Spinner label="Loading course…" />;
  const canEdit = c.role === 'owner' || c.role === 'co-teacher' || c.role === 'admin';

  return (
    <div>
      <div className="page-head">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Link to="/courses" className="link" style={{ fontSize: 12 }}>← Courses</Link>
          </div>
          <h1 className="page-title" style={{ marginTop: 4 }}>
            <span style={{ color: c.color }}>{c.code}</span> — {c.title}
          </h1>
          <div className="page-sub">{c.term} · {c.students_count} students · {c.exams_count} exams {c.role !== 'owner' && <>· <b style={{ color: '#6d28d9' }}>{c.role}</b></>}</div>
        </div>
        <div className="page-actions">
          <Btn kind="outline" icon="download" onClick={() => window.open(`/api/courses/${id}/export.csv`, '_blank')}>Roll-up CSV</Btn>
          {canEdit && <Btn kind="primary" icon="plus" onClick={() => navigate(`/exams?new=1&course=${id}`)}>New Exam</Btn>}
        </div>
      </div>

      <Seg value={tab} onChange={setTab} options={[
        { value: 'exams', label: `Exams (${c.exams.length})` },
        { value: 'roster', label: `Roster (${c.students_count})` },
        { value: 'rollup', label: 'Results Roll-up' },
        { value: 'teachers', label: `Teachers (${c.teachers.length})` },
        { value: 'notes', label: `Notes (${c.notes.length})` },
      ]} />
      <div style={{ height: 16 }} />

      {tab === 'exams' && <ExamsTab course={c} reload={load} navigate={navigate} toast={toast} canEdit={canEdit} />}
      {tab === 'roster' && <RosterTab course={c} reload={load} toast={toast} canEdit={canEdit} />}
      {tab === 'rollup' && <RollupTab course={c} />}
      {tab === 'teachers' && <TeachersTab course={c} reload={load} toast={toast} />}
      {tab === 'notes' && <NotesTab course={c} reload={load} toast={toast} canEdit={canEdit} />}
    </div>
  );
}

/* ------------------------------- Exams tab ---------------------------------- */
function ExamsTab({ course, reload, navigate, toast, canEdit }) {
  const del = async (e, id) => {
    e.stopPropagation();
    if (!confirm('Delete this exam? Only exams without attempts can be deleted.')) return;
    try { await api.del(`/api/exams/${id}`); toast('Exam deleted'); reload(); }
    catch (err) { toast(err.message, 'err'); }
  };
  const close = async (e, id) => {
    e.stopPropagation();
    if (!confirm('Force-close this exam now? All in-progress attempts will be auto-submitted.')) return;
    try { await api.post(`/api/exams/${id}/close`); toast('Exam closed; in-progress attempts auto-submitted'); reload(); }
    catch (err) { toast(err.message, 'err'); }
  };
  return (
    <Card pad={false}>
      {course.exams.length === 0 ? (
        <Empty icon="exams" title="No exams yet" hint="Create the first exam for this course." />
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Exam</th><th>Window</th><th>Code</th><th>Status</th><th>Questions</th><th>Participants</th><th>Results</th><th></th></tr></thead>
            <tbody>
              {course.exams.map((e) => (
                <tr key={e.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/exams/${e.id}`)}>
                  <td className="t-strong">{e.title}{e.use_roster_override && <div style={{ fontSize: 10.5, color: '#6d28d9' }}>Override roster</div>}</td>
                  <td>{fmtDate(e.start_at)} · {fmtTime(e.start_at)}<div style={{ fontSize: 11, color: 'var(--muted)' }}>{e.duration_min} min</div></td>
                  <td><code style={{ background: '#f1f5f9', padding: '2px 7px', borderRadius: 6, fontSize: 11.5 }}>{e.access_code}</code></td>
                  <td>{statusBadge(e.status)}{e.live_participants > 0 && <div style={{ fontSize: 10.5, color: '#15803d' }}>{e.live_participants} online</div>}</td>
                  <td>{e.questions}</td>
                  <td>{e.participants}</td>
                  <td>{e.results_released ? <Badge kind="success">Released</Badge> : <Badge kind="muted">Not released</Badge>}</td>
                  <td onClick={(ev) => ev.stopPropagation()} style={{ whiteSpace: 'nowrap' }}>
                    {e.status === 'live' && canEdit && <Btn kind="outline" size="sm" onClick={(ev) => close(ev, e.id)}>Close</Btn>}{' '}
                    {e.participants === 0 && canEdit && <Btn kind="outline" size="sm" icon="trash" onClick={(ev) => del(ev, e.id)} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/* ------------------------------- Roster tab --------------------------------- */
function RosterTab({ course, reload, toast, canEdit }) {
  const [rows, setRows] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showCsv, setShowCsv] = useState(false);
  const [form, setForm] = useState({ roll_no: '', name: '', email: '' });
  const [csvText, setCsvText] = useState('');
  const fileRef = useRef();
  const load = () => api.get(`/api/courses/${course.id}/roster`).then(setRows);
  useEffect(() => { load(); }, [course.id]);

  const add = async () => {
    try { await api.post(`/api/courses/${course.id}/roster`, form); toast('Student added'); setShowAdd(false); setForm({ roll_no: '', name: '', email: '' }); load(); reload(); }
    catch (e) { toast(e.message, 'err'); }
  };
  const remove = async (sid) => {
    if (!confirm('Remove this student from the roster? (Future exams only — in-progress attempts are unaffected.)')) return;
    await api.del(`/api/courses/${course.id}/roster/${sid}`); load(); reload();
  };
  const sendCsv = async (fd, isText) => {
    try {
      const r = isText ? await api.post(`/api/courses/${course.id}/roster/csv`, { text: csvText }) : await api.upload(`/api/courses/${course.id}/roster/csv`, fd);
      toast(`Imported ${r.added} students (${r.skipped} skipped)`);
      setShowCsv(false); setCsvText(''); load(); reload();
    } catch (e) { toast(e.message, 'err'); }
  };

  if (!rows) return <Spinner />;
  return (
    <Card title="Course Roster" action={canEdit && (
      <div style={{ display: 'flex', gap: 8 }}>
        <a className="link" href={`/api/courses/${course.id}/roster/template`}>CSV template</a>
        <Btn kind="outline" size="sm" icon="upload" onClick={() => setShowCsv(true)}>CSV upload</Btn>
        <Btn kind="primary" size="sm" icon="plus" onClick={() => setShowAdd(true)}>Add student</Btn>
      </div>
    )} pad={false}>
      <div style={{ padding: '0 18px' }}><div className="hint" style={{ paddingTop: 6 }}>Roster changes apply to future exams; in-progress or completed attempts are never altered retroactively.</div></div>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>Roll No</th><th>Name</th><th>Email</th><th>Added via</th><th></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="t-strong">{r.roll_no}</td><td>{r.name}</td><td>{r.email || '—'}</td>
                <td><Badge kind={r.added_via === 'csv' ? 'info' : 'muted'}>{r.added_via}</Badge></td>
                <td>{canEdit && <button className="icon-btn" onClick={() => remove(r.id)}><Icon name="trash" size={14} /></button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add student to roster"
        footer={<><Btn kind="outline" onClick={() => setShowAdd(false)}>Cancel</Btn><Btn kind="primary" onClick={add} disabled={!form.roll_no}>Add</Btn></>}>
        <Field label="Roll number"><input className="input" value={form.roll_no} onChange={(e) => setForm({ ...form, roll_no: e.target.value })} placeholder="STU-1042" /></Field>
        <Field label="Full name"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Jane Doe" /></Field>
        <Field label="Email (optional)"><input className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="jane@student.edu" /></Field>
      </Modal>

      <Modal open={showCsv} onClose={() => setShowCsv(false)} title="Bulk import via CSV"
        footer={<>
          <Btn kind="outline" onClick={() => setShowCsv(false)}>Cancel</Btn>
          <Btn kind="outline" icon="upload" onClick={() => fileRef.current.click()}>Choose file…</Btn>
          <Btn kind="primary" onClick={() => sendCsv(null, true)} disabled={!csvText.trim()}>Import pasted CSV</Btn>
        </>}>
        <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files[0]; if (!f) return; const fd = new FormData(); fd.append('file', f); sendCsv(fd, false); e.target.value = ''; }} />
        <Field label="Paste CSV" hint="Columns: roll_no, name, email — with or without a header row.">
          <textarea className="textarea" rows={7} value={csvText} onChange={(e) => setCsvText(e.target.value)}
            placeholder={'roll_no,name,email\nSTU-2001,Ada Lovelace,ada@student.edu\nSTU-2002,Alan Turing,alan@student.edu'} />
        </Field>
      </Modal>
    </Card>
  );
}

/* ------------------------------- Rollup tab --------------------------------- */
function RollupTab({ course }) {
  const [d, setD] = useState(null);
  useEffect(() => { api.get(`/api/courses/${course.id}/rollup`).then(setD); }, [course.id]);
  if (!d) return <Spinner />;
  if (!d.exams.length) return <Card><Empty icon="chart" title="No exams in this course yet" /></Card>;
  return (
    <Card title="Student performance across all exams in this course" pad={false}>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr><th>Roll No</th><th>Student</th>{d.exams.map((e) => <th key={e.id} title={e.title}>{e.title.length > 18 ? e.title.slice(0, 18) + '…' : e.title}{e.cohort_avg != null && <div style={{ textTransform: 'none', color: 'var(--faint)' }}>avg {e.cohort_avg}%</div>}</th>)}<th>Course Avg</th><th>Trend</th></tr>
          </thead>
          <tbody>
            {d.students.map((s) => (
              <tr key={s.id}>
                <td className="t-strong">{s.roll_no}</td>
                <td>{s.name}</td>
                {s.exams.map((x, i) => (
                  <td key={i}>{x ? <b style={{ color: x.pct >= 50 ? '#15803d' : '#b91c1c' }}>{x.pct}%</b> : <span style={{ color: 'var(--faint)' }}>—</span>}</td>
                ))}
                <td className="t-strong">{s.avg != null ? `${s.avg}%` : '—'}</td>
                <td>{s.trend != null ? <span className={s.trend >= 0 ? 'trend-up' : 'trend-down'}>{s.trend >= 0 ? '↑' : '↓'} {Math.abs(s.trend)}%</span> : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/* ------------------------------ Teachers tab -------------------------------- */
function TeachersTab({ course, reload, toast }) {
  const [rows, setRows] = useState(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('co-teacher');
  const load = () => api.get(`/api/courses/${course.id}/teachers`).then(setRows);
  useEffect(() => { load(); }, [course.id]);
  const invite = async () => {
    try { await api.post(`/api/courses/${course.id}/teachers`, { email, role }); toast('Teacher added'); setEmail(''); load(); reload(); }
    catch (e) { toast(e.message, 'err'); }
  };
  const remove = async (tid) => { await api.del(`/api/courses/${course.id}/teachers/${tid}`); load(); reload(); };
  if (!rows) return <Spinner />;
  return (
    <div className="g-300">
      <Card title="Course staff" pad={false}>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th></th></tr></thead>
            <tbody>
              {course.teachers.map((t) => (
                <tr key={t.id}>
                  <td className="t-strong">{t.name}</td><td>{t.email}</td>
                  <td><Badge kind={t.role === 'owner' ? 'info' : 'violet'}>{t.role}</Badge></td>
                  <td>{course.role === 'owner' && t.role !== 'owner' && <button className="icon-btn" onClick={() => remove(t.id)}><Icon name="trash" size={14} /></button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {course.role === 'owner' && (
        <Card title="Invite co-teacher / TA">
          <Field label="Teacher email" hint="They must have an ExamPro account (register on the login page).">
            <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="colleague@exampro.edu" />
          </Field>
          <Field label="Role">
            <select className="select" value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="co-teacher">Co-teacher — full course access</option>
              <option value="ta">TA — monitor &amp; grade, no structural changes</option>
            </select>
          </Field>
          <Btn kind="primary" className="btn-block" onClick={invite} disabled={!email}>Add to course</Btn>
        </Card>
      )}
    </div>
  );
}

/* -------------------------------- Notes tab --------------------------------- */
function NotesTab({ course, reload, toast, canEdit }) {
  const fileRef = useRef();
  const upload = async (f) => {
    if (!f) return;
    const fd = new FormData(); fd.append('file', f);
    try { await api.upload(`/api/courses/${course.id}/notes`, fd); toast('Notes uploaded'); reload(); }
    catch (e) { toast(e.message, 'err'); }
  };
  return (
    <Card title="Reference notes" action={canEdit && <Btn kind="primary" size="sm" icon="upload" onClick={() => fileRef.current.click()}>Upload notes</Btn>}>
      <input ref={fileRef} type="file" accept=".txt,.md,.pdf,.csv" style={{ display: 'none' }} onChange={(e) => { upload(e.target.files[0]); e.target.value = ''; }} />
      <div className="hint" style={{ marginBottom: 10 }}>Notes power Gemini question generation and AI essay grading (PRD 4.8/4.9). .txt/.md/.pdf up to 20&nbsp;MB.</div>
      {course.notes.length === 0 ? <Empty icon="file" title="No notes yet" /> : course.notes.map((n) => (
        <div className="feed-item" key={n.id}>
          <div className="feed-ic" style={{ background: '#e9f0ff', color: '#2563eb' }}><Icon name="file" size={14} /></div>
          <div><b>{n.filename}</b><div style={{ fontSize: 11, color: 'var(--muted)' }}>{(n.chars / 1000).toFixed(1)}k chars extracted · {fmtDate(n.created_at)}</div></div>
        </div>
      ))}
    </Card>
  );
}
