import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import {
  Card, Btn, Spinner, Empty, Badge, Icon, Bars, ProgressBar, Seg, Modal,
  statusBadge, fmtDateTime, fmtTime,
} from '../ui.jsx';

export default function ExamAnalytics() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [d, setD] = useState(null);
  const [tab, setTab] = useState('students');
  const [drill, setDrill] = useState(null);
  const load = () => api.get(`/api/exams/${id}/analytics`).then(setD);
  useEffect(() => { setD(null); load(); }, [id]);

  if (!d) return <Spinner label="Crunching results…" />;
  const { exam, stats, histogram, questions, students, overrides } = d;
  const difficult = [...questions].filter((q) => q.pct_correct != null).sort((a, b) => a.pct_correct - b.pct_correct).slice(0, 5);

  return (
    <div>
      <div className="page-head">
        <div>
          <Link to="/results" className="link" style={{ fontSize: 12 }}>← Results</Link>
          <h1 className="page-title" style={{ marginTop: 4 }}>{exam.title}</h1>
          <div className="page-sub">{fmtDateTime(exam.start_at)} · {statusBadge(exam.status)} · Pass mark {exam.pass_pct}%</div>
        </div>
        <div className="page-actions">
          {!exam.results_released && <Btn kind="success" icon="check" onClick={() => api.post(`/api/exams/${exam.id}/release`).then(load)}>Release to students</Btn>}
          <Btn kind="outline" icon="download" onClick={() => window.open(`/api/exams/${exam.id}/export.csv`, '_blank')}>CSV</Btn>
          <Btn kind="outline" icon="download" onClick={() => window.open(`/api/exams/${exam.id}/export.pdf`, '_blank')}>PDF Report</Btn>
        </div>
      </div>

      <div className="stat-row">
        {[
          ['Participants', `${stats.participants}/${stats.roster}`], ['Average', `${stats.avg}%`], ['Median', `${stats.median}%`],
          ['Range', `${stats.min}–${stats.max}%`], ['Pass', stats.pass], ['Fail', stats.fail],
        ].map(([l, v]) => (
          <Card key={l} pad={false}><div className="stat"><div><div className="stat-num" style={{ fontSize: 19 }}>{v}</div><div className="stat-sub">{l}</div></div></div></Card>
        ))}
      </div>

      <div className="g-r3" style={{ marginBottom: 16 }}>
        <Card title="Score distribution (% of maximum)">
          <Bars values={histogram} />
        </Card>
        <Card title="Most-missed questions" action={<span className="hint">item difficulty</span>}>
          {difficult.length === 0 && <Empty icon="check" title="No MCQ data" />}
          {difficult.map((q) => (
            <div key={q.id} style={{ padding: '7px 0', borderBottom: '1px solid var(--line-2)', fontSize: 12.5 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                <span style={{ color: 'var(--ink)' }}>{q.text.slice(0, 70)}{q.text.length > 70 ? '…' : ''}</span>
                <b style={{ color: q.pct_correct < 50 ? '#b91c1c' : '#b45309', flex: 'none' }}>{q.pct_correct}%</b>
              </div>
              <ProgressBar thin pct={q.pct_correct} color={q.pct_correct < 50 ? '#ef4444' : '#f59e0b'} />
            </div>
          ))}
        </Card>
      </div>

      <Seg value={tab} onChange={setTab} options={[
        { value: 'students', label: `Students (${students.length})` },
        { value: 'questions', label: `Per-question (${questions.length})` },
        { value: 'overrides', label: `Grading audit (${overrides.length})` },
      ]} />
      <div style={{ height: 14 }} />

      {tab === 'students' && (
        <Card pad={false}>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Roll</th><th>Student</th><th>Status</th><th>Violations</th><th>Answered</th><th>Score</th><th>%</th><th>Result</th><th></th></tr></thead>
              <tbody>
                {students.map((s) => (
                  <tr key={s.attempt_id} style={{ cursor: 'pointer' }} onClick={() => api.get(`/api/attempts/${s.attempt_id}`).then(setDrill)}>
                    <td className="t-strong">{s.roll_no}</td><td>{s.name}</td>
                    <td>{statusBadge(s.status)}</td>
                    <td>{s.violations > 0 ? <Badge kind="warn">{s.violations}⚑</Badge> : '—'}</td>
                    <td>{s.answered}</td>
                    <td className="t-strong">{s.score ?? '—'}<span style={{ color: 'var(--muted)' }}>/{s.max_score ?? '—'}</span></td>
                    <td><b style={{ color: s.pct == null ? 'var(--muted)' : s.pct >= exam.pass_pct ? '#15803d' : '#b91c1c' }}>{s.pct ?? '—'}{s.pct != null && '%'}</b></td>
                    <td>{s.pct == null ? '—' : s.pct >= exam.pass_pct ? <Badge kind="success">PASS</Badge> : <Badge kind="danger">FAIL</Badge>}</td>
                    <td><Icon name="eye" size={15} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'questions' && (
        <Card pad={false}>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>#</th><th>Question</th><th>Type</th><th>Pts</th><th>Attempted</th><th>% correct</th><th>Avg score</th></tr></thead>
              <tbody>
                {questions.map((q, i) => (
                  <tr key={q.id}>
                    <td>{i + 1}</td>
                    <td className="t-strong" style={{ maxWidth: 420 }}>{q.text}</td>
                    <td><Badge kind={q.type === 'mcq' ? 'info' : 'violet'}>{q.type}</Badge></td>
                    <td>{q.points}</td><td>{q.attempted}</td>
                    <td>{q.pct_correct != null ? <b style={{ color: q.pct_correct < 50 ? '#b91c1c' : '#15803d' }}>{q.pct_correct}%</b> : '—'}</td>
                    <td>{q.avg_score}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'overrides' && (
        <Card pad={false}>
          {overrides.length === 0 ? <Empty icon="shield" title="No AI score overrides" hint="Every AI suggestion was confirmed as-is, or AI grading wasn't used." /> : (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>When</th><th>Teacher</th><th>AI score</th><th>Final score</th></tr></thead>
                <tbody>
                  {overrides.map((o) => (
                    <tr key={o.id}>
                      <td>{fmtDateTime(o.created_at)}</td><td className="t-strong">{o.teacher_name}</td>
                      <td><Badge kind="violet">{o.ai_score ?? '—'}</Badge></td>
                      <td><Badge kind="success">{o.teacher_score}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {drill && <Drill drill={drill} onClose={() => setDrill(null)} />}
    </div>
  );
}

function Drill({ drill, onClose }) {
  const { attempt, student, items, violations } = drill;
  return (
    <Modal open onClose={onClose} title={`${student.name} — answer detail`} wide>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {statusBadge(attempt.status)}
        {attempt.score != null && <Badge kind="info">{attempt.score}/{attempt.max_score} pts</Badge>}
        {attempt.violations_count > 0 && <Badge kind="warn">{attempt.violations_count} violations</Badge>}
        <Btn kind="outline" size="sm" icon="download" onClick={() => window.open(`/api/attempts/${attempt.id}/report.pdf`, '_blank')}>Student PDF</Btn>
      </div>
      <div style={{ maxHeight: '50vh', overflowY: 'auto' }}>
        {items.map((q) => (
          <div key={q.question_id} style={{ borderBottom: '1px solid var(--line-2)', padding: '10px 0', fontSize: 13 }}>
            <b style={{ color: 'var(--ink)' }}>Q{q.position}.</b> <span style={{ color: 'var(--ink)' }}>{q.text}</span>
            <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 4 }}>
              {q.type === 'mcq' ? (
                <>Student answered <b style={{ color: q.is_correct ? '#15803d' : '#b91c1c' }}>{q.selected_index != null ? q.options[q.selected_index] : '—'}</b>
                  {!q.is_correct && q.selected_index != null && <> · correct: <b style={{ color: '#15803d' }}>{q.options[q.correct_index]}</b></>}</>
              ) : (
                <>
                  <em style={{ color: 'var(--body)' }}>{q.essay_text ? `“${q.essay_text.slice(0, 200)}…”` : 'No answer'}</em>
                  {q.ai_score != null && <div>AI: <b>{q.ai_score}/{q.points}</b> — {q.ai_rationale}</div>}
                  {q.final_score != null ? <div>Final: <b style={{ color: '#15803d' }}>{q.final_score}/{q.points}</b></div> : <div style={{ color: '#b45309' }}>Awaiting teacher review</div>}
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}
