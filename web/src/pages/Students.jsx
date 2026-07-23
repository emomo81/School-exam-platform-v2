import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { Card, Btn, Spinner, Empty, Badge, Icon } from '../ui.jsx';
import { useCourses } from '../Shell.jsx';

export default function Students() {
  const { courses } = useCourses();
  const navigate = useNavigate();
  const [courseId, setCourseId] = useState(null);
  const [rows, setRows] = useState(null);
  const [search, setSearch] = useState('');

  useEffect(() => { if (courses.length && !courseId) setCourseId(courses[0].id); }, [courses]);
  useEffect(() => {
    if (!courseId) return;
    setRows(null);
    api.get(`/api/courses/${courseId}/roster`).then(setRows).catch(() => setRows([]));
  }, [courseId]);

  const filtered = useMemo(() => (rows || []).filter((r) =>
    `${r.roll_no} ${r.name} ${r.email || ''}`.toLowerCase().includes(search.toLowerCase())), [rows, search]);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Students</h1>
          <div className="page-sub">Rosters live at course level — every exam in the course inherits them by default.</div>
        </div>
        <div className="page-actions">
          <select className="select" style={{ width: 260 }} value={courseId || ''} onChange={(e) => setCourseId(Number(e.target.value))}>
            {courses.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.title}</option>)}
          </select>
          <Btn kind="primary" icon="plus" onClick={() => navigate(`/courses/${courseId}?tab=roster`)}>Add / Import</Btn>
        </div>
      </div>
      <Card pad={false}>
        <div style={{ padding: '14px 18px 0', maxWidth: 300 }}>
          <input className="input" placeholder="Search roll no, name, email…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {!rows ? <Spinner /> : filtered.length === 0 ? <Empty icon="students" title="No students found" /> : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Roll No</th><th>Name</th><th>Email</th><th>Added via</th><th>Since</th></tr></thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id}>
                    <td className="t-strong">{r.roll_no}</td><td>{r.name}</td><td>{r.email || '—'}</td>
                    <td><Badge kind={r.added_via === 'csv' ? 'info' : 'muted'}>{r.added_via}</Badge></td>
                    <td style={{ color: 'var(--muted)' }}>{new Date(r.created_at).toLocaleDateString()}</td>
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
