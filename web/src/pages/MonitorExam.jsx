import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api, openMonitorStream } from '../api.js';
import {
  Card, Btn, Spinner, Empty, Badge, Icon, Modal, statusBadge,
  fmtTime, fmtDur, timeAgo, ProgressBar,
} from '../ui.jsx';

export default function MonitorExam() {
  const { id } = useParams();
  const [snap, setSnap] = useState(null);
  const [feedKeys, setFeedKeys] = useState({});
  const [drill, setDrill] = useState(null);
  const [filter, setFilter] = useState('');
  const [tab, setTab] = useState('grid');

  const load = () => api.get(`/api/exams/${id}/monitor`).then(setSnap).catch(() => {});
  useEffect(() => {
    setSnap(null); load();
    // SSE: server pushes a lightweight event; we refetch the snapshot (cheap locally).
    const close = openMonitorStream(id, (kind) => {
      load();
      if (kind === 'violation') setTab((t) => t); // keep state; feed refreshes via load()
    });
    const t = setInterval(load, 8000); // safety net
    return () => { close(); clearInterval(t); };
  }, [id]);

  if (!snap) return <Spinner label="Connecting to live session…" />;
  const { exam, counts, students, feed } = snap;
  const shown = students.filter((s) => `${s.roll_no} ${s.name}`.toLowerCase().includes(filter.toLowerCase()));
  const cellClass = (s) => (s.violations >= 2 ? 'crit' : s.violations === 1 ? 'warn' : s.status === 'not_started' ? 'done' : 'ok');

  return (
    <div>
      <div className="page-head">
        <div>
          <Link to="/monitoring" className="link" style={{ fontSize: 12 }}>← Live Monitoring</Link>
          <h1 className="page-title" style={{ marginTop: 4 }}>
            <span className="live-dot" style={{ marginRight: 10 }} />{exam.title}
          </h1>
          <div className="page-sub">
            {exam.course} · ends {fmtTime(exam.ends_at)} · <b style={{ color: '#b45309' }}>{exam.severity_policy.replace('_', ' ')}</b> · {exam.total_questions} questions
          </div>
        </div>
        <div className="page-actions stat-chips">
          <span className="chip"><span className="sw" style={{ background: '#16a34a' }} />{counts.active} active</span>
          <span className="chip"><span className="sw" style={{ background: '#f59e0b' }} />{counts.disconnected} disconnected</span>
          <span className="chip"><span className="sw" style={{ background: '#2563eb' }} />{counts.submitted} submitted</span>
          <span className="chip"><span className="sw" style={{ background: '#ef4444' }} />{counts.flagged} flagged</span>
          <span className="chip"><span className="sw" style={{ background: '#cbd5e1' }} />{counts.not_started} not started</span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, alignItems: 'center' }}>
        <div className="seg">
          {[['grid', 'Student grid'], ['feed', `Violation feed (${feed.length})`]].map(([v, l]) => (
            <button key={v} className={`seg-btn ${tab === v ? 'on' : ''}`} onClick={() => setTab(v)}>{l}</button>
          ))}
        </div>
        <input className="input" style={{ width: 250, marginLeft: 'auto' }} placeholder="Find student…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>

      {tab === 'grid' ? (
        <div className="mon-grid">
          {shown.map((s) => (
            <button key={s.student_id} className={`mon-cell ${cellClass(s)}`} onClick={() => s.attempt_id && api.get(`/api/attempts/${s.attempt_id}`).then(setDrill)} disabled={!s.attempt_id}>
              <div className="mon-flags">
                {s.violations > 0 && <Badge kind={s.violations >= 2 ? 'danger' : 'warn'}>{s.violations}⚑</Badge>}
              </div>
              <b>{s.name}</b>
              <div style={{ color: 'var(--muted)', fontSize: 11, marginBottom: 7 }}>{s.roll_no}</div>
              {s.status === 'not_started' ? <div className="hint">Not started</div> : (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
                    <span>{s.answered}/{exam.total_questions} answered</span>
                    {s.remaining_ms != null && <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtDur(s.remaining_ms).slice(0, 5)}</span>}
                  </div>
                  <ProgressBar thin pct={exam.total_questions ? (s.answered / exam.total_questions) * 100 : 0}
                    color={s.violations >= 2 ? '#ef4444' : s.violations === 1 ? '#f59e0b' : '#16a34a'} />
                </>
              )}
              <div style={{ marginTop: 7 }}>{statusBadge(s.status)}</div>
            </button>
          ))}
          {!shown.length && <Empty icon="students" title="No matches" />}
        </div>
      ) : (
        <Card pad={false}>
          {feed.length === 0 ? <Empty icon="shield" title="No violations yet" /> : (
            <div style={{ padding: '8px 18px' }}>
              {feed.map((v) => (
                <div className="feed-item" key={v.id}>
                  <div className="feed-ic" style={{ background: v.strike >= 3 ? '#fee2e2' : '#fef3c7', color: v.strike >= 3 ? '#b91c1c' : '#b45309' }}>
                    <Icon name="alert" size={14} />
                  </div>
                  <div>
                    <b>{v.name}</b> <span style={{ color: 'var(--muted)' }}>({v.roll_no})</span>
                    <div style={{ fontSize: 11.5 }}>{v.label} — strike {v.strike}</div>
                  </div>
                  <span className="time">{timeAgo(v.created_at)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      <DrillModal drill={drill} onClose={() => setDrill(null)} />
    </div>
  );
}

function DrillModal({ drill, onClose }) {
  if (!drill) return null;
  const { attempt, student, items, violations, exam } = drill;
  return (
    <Modal open onClose={onClose} title={`${student.name} (${student.roll_no})`} wide>
      <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        {statusBadge(attempt.status)}
        <Badge kind={attempt.violations_count ? 'warn' : 'muted'}>{attempt.violations_count} violations</Badge>
        {attempt.score != null && <Badge kind="info">Score {attempt.score}/{attempt.max_score}</Badge>}
        <Badge kind="muted">Started {fmtTime(attempt.started_at)}</Badge>
        <Btn kind="outline" size="sm" icon="download" onClick={() => window.open(`/api/attempts/${attempt.id}/report.pdf`, '_blank')}>Report PDF</Btn>
      </div>
      {violations.length > 0 && (
        <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: 10, marginBottom: 12, fontSize: 12.5 }}>
          <b>Violation history:</b> {violations.map((v) => `#${v.strike} ${v.label}`).join(' · ')}
        </div>
      )}
      <div style={{ maxHeight: '46vh', overflowY: 'auto' }}>
        {items.map((q) => (
          <div key={q.question_id} style={{ borderBottom: '1px solid var(--line-2)', padding: '10px 0', fontSize: 13 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <span className={`verdict ${q.type === 'essay' ? (q.final_score != null ? 'ok' : 'na') : q.is_correct == null ? 'na' : q.is_correct ? 'ok' : 'no'}`}>
                {q.type === 'essay' ? 'E' : q.is_correct ? '✓' : '✗'}
              </span>
              <div style={{ flex: 1 }}>
                <b style={{ color: 'var(--ink)' }}>Q{q.position}.</b> <span style={{ color: 'var(--ink)' }}>{q.text}</span>
                <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 4 }}>
                  {q.type === 'mcq' ? (
                    <>Student: <b>{q.selected_index != null ? q.options[q.selected_index] : '—'}</b> · Correct: <b style={{ color: '#15803d' }}>{q.options[q.correct_index]}</b></>
                  ) : (
                    <>
                      <div style={{ color: 'var(--body)', fontStyle: 'italic' }}>{q.essay_text ? `“${q.essay_text.slice(0, 180)}${q.essay_text.length > 180 ? '…' : ''}”` : 'No answer'}</div>
                      {q.ai_score != null && <div style={{ marginTop: 3 }}>AI suggestion: <b>{q.ai_score}/{q.points}</b> — {q.ai_rationale}</div>}
                      {q.final_score != null && <div>Final: <b style={{ color: '#15803d' }}>{q.final_score}/{q.points}</b></div>}
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}
