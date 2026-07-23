import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Card, Btn, Spinner, Empty, Icon, statusBadge, fmtDateTime } from '../ui.jsx';
import { useCourses } from '../Shell.jsx';

export default function Reports() {
  const [exams, setExams] = useState(null);
  const { courses } = useCourses();
  useEffect(() => { api.get('/api/exams').then((all) => setExams(all.filter((e) => e.participants > 0))); }, []);
  if (!exams) return <Spinner />;
  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Reports</h1>
          <div className="page-sub">Exports are logged to the audit trail. CSV opens in Excel; PDF is print-ready.</div>
        </div>
      </div>

      <div className="g-r2">
        <Card title="Exam reports" pad={false}>
          {exams.length === 0 ? <Empty icon="report" title="No completed attempts yet" /> : (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>Exam</th><th>Status</th><th>Attempts</th><th>Exports</th></tr></thead>
                <tbody>
                  {exams.map((e) => (
                    <tr key={e.id}>
                      <td className="t-strong">{e.title}<div style={{ fontSize: 11, color: 'var(--muted)' }}>{e.course?.code} · {fmtDateTime(e.start_at)}</div></td>
                      <td>{statusBadge(e.status)}</td>
                      <td>{e.participants}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <Btn kind="outline" size="sm" icon="download" onClick={() => window.open(`/api/exams/${e.id}/export.csv`, '_blank')}>CSV</Btn>{' '}
                        <Btn kind="outline" size="sm" icon="download" onClick={() => window.open(`/api/exams/${e.id}/export.pdf`, '_blank')}>PDF</Btn>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Course roll-up reports" pad={false}>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Course</th><th>Students</th><th>Avg</th><th>Export</th></tr></thead>
              <tbody>
                {courses.map((c) => (
                  <tr key={c.id}>
                    <td className="t-strong">{c.code} — {c.title}<div style={{ fontSize: 11, color: 'var(--muted)' }}>{c.term}</div></td>
                    <td>{c.students_count}</td>
                    <td>{c.avg_score != null ? `${c.avg_score}%` : '—'}</td>
                    <td><Btn kind="outline" size="sm" icon="download" onClick={() => window.open(`/api/courses/${c.id}/export.csv`, '_blank')}>CSV</Btn></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
