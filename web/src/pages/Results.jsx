import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { Card, Btn, Spinner, Empty, Badge, Icon, statusBadge, fmtDateTime } from '../ui.jsx';

export default function Results() {
  const [exams, setExams] = useState(null);
  const navigate = useNavigate();
  useEffect(() => { api.get('/api/exams').then((all) => setExams(all.filter((e) => e.participants > 0))); }, []);
  if (!exams) return <Spinner />;
  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Results &amp; Analytics</h1>
          <div className="page-sub">Score distributions, per-question difficulty, per-student drill-down, exports.</div>
        </div>
      </div>
      <Card pad={false}>
        {exams.length === 0 ? <Empty icon="chart" title="No results yet" hint="Results appear once students submit attempts." /> : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Exam</th><th>Course</th><th>Window</th><th>Status</th><th>Attempts</th><th>Flagged</th><th>Results</th><th></th></tr></thead>
              <tbody>
                {exams.map((e) => (
                  <tr key={e.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/results/${e.id}`)}>
                    <td className="t-strong">{e.title}</td>
                    <td>{e.course?.code}</td>
                    <td>{fmtDateTime(e.start_at)}</td>
                    <td>{statusBadge(e.status)}</td>
                    <td>{e.participants}</td>
                    <td>{e.flagged > 0 ? <Badge kind="warn">{e.flagged}</Badge> : '—'}</td>
                    <td>{e.results_released ? <Badge kind="success">Released</Badge> : <Badge kind="muted">Not released</Badge>}</td>
                    <td><Icon name="chevR" size={15} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
