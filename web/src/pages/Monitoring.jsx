import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { Card, Btn, Spinner, Empty, Badge, Icon, statusBadge, fmtDateTime, fmtTime, fmtDur } from '../ui.jsx';

export default function Monitoring() {
  const [exams, setExams] = useState(null);
  const navigate = useNavigate();
  useEffect(() => {
    api.get('/api/exams').then((all) => setExams(all.filter((e) => e.status !== 'ended' || e.participants > 0)));
    const t = setInterval(() => api.get('/api/exams').then((all) => setExams(all.filter((e) => e.status !== 'ended' || e.participants > 0))), 15000);
    return () => clearInterval(t);
  }, []);

  if (!exams) return <Spinner label="Loading…" />;
  const live = exams.filter((e) => e.status === 'live');
  const scheduled = exams.filter((e) => e.status === 'scheduled');
  const recent = exams.filter((e) => e.status === 'ended').slice(0, 5);

  const Row = ({ e, dim }) => (
    <div className="exam-row" style={{ cursor: 'pointer', opacity: dim ? 0.75 : 1 }} onClick={() => navigate(`/monitoring/${e.id}`)}>
      <div className="er-ic" style={{ background: e.status === 'live' ? '#dcfce7' : '#e9f0ff', color: e.status === 'live' ? '#15803d' : '#2563eb' }}>
        <Icon name="monitor" size={16} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <b>{e.title}</b>
        <small>{e.course?.code} · {fmtDateTime(e.start_at)}</small>
      </div>
      {e.status === 'live' && (
        <div style={{ textAlign: 'right' }}>
          <div><b style={{ color: '#15803d' }}>{e.live_participants}</b> online · {e.flagged > 0 && <span style={{ color: '#b45309' }}>{e.flagged} flagged</span>}</div>
          <small style={{ color: 'var(--muted)' }}>ends {fmtTime(e.ends_at)}</small>
        </div>
      )}
      {e.status === 'scheduled' && <small style={{ color: 'var(--muted)' }}>{e.questions} questions</small>}
      {e.status === 'ended' && <small style={{ color: 'var(--muted)' }}>{e.participants} attempts</small>}
      {statusBadge(e.status)}
    </div>
  );

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Live Monitoring</h1>
          <div className="page-sub">Real-time proctoring view — sessions, progress, and violation flags as they happen.</div>
        </div>
      </div>
      <div className="g-r2">
        <Card title={<><span className="live-dot" style={{ marginRight: 8 }} />Live now ({live.length})</>}>
          {live.length === 0 ? <Empty icon="monitor" title="No live exams" hint="Exams appear here automatically during their window." />
            : live.map((e) => <Row key={e.id} e={e} />)}
        </Card>
        <div className="grid">
          <Card title="Scheduled">
            {scheduled.length === 0 ? <Empty icon="calendar" title="Nothing scheduled" /> : scheduled.slice(0, 5).map((e) => <Row key={e.id} e={e} dim />)}
          </Card>
          <Card title="Recently ended">
            {recent.length === 0 ? <Empty icon="clock" title="No completed exams" /> : recent.map((e) => <Row key={e.id} e={e} dim />)}
          </Card>
        </div>
      </div>
    </div>
  );
}
