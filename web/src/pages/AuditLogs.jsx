import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Card, Spinner, Empty, Badge, fmtDateTime } from '../ui.jsx';

export default function AuditLogs() {
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');
  const load = (f) => api.get(`/api/audit${f ? `?action=${encodeURIComponent(f)}` : ''}`).then(setRows);
  useEffect(() => { load(); }, []);
  useEffect(() => { const t = setTimeout(() => load(q), 350); return () => clearTimeout(t); }, [q]);

  const kind = (a) => {
    if (a.includes('violation') || a.includes('terminated') || a.includes('denied')) return 'danger';
    if (a.includes('override') || a.includes('flagged')) return 'warn';
    if (a.includes('ai.')) return 'violet';
    if (a.includes('results') || a.includes('grade')) return 'success';
    if (a.includes('export')) return 'info';
    return 'muted';
  };

  if (!rows) return <Spinner />;
  return (
    <div>
      <div className="page-head">
        <div><h1 className="page-title">Audit Logs</h1><div className="page-sub">Every grading override, violation, roster change and export is recorded (PRD §7).</div></div>
        <div className="page-actions">
          <input className="input" style={{ width: 240 }} placeholder="Filter by action…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <Card pad={false}>
        {rows.length === 0 ? <Empty icon="audit" title="No log entries" /> : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Entity</th><th>Detail</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(r.created_at)}</td>
                    <td>{r.actor_name || r.actor_type}{r.actor_type !== 'teacher' && <span style={{ color: 'var(--muted)' }}> ({r.actor_type})</span>}</td>
                    <td><Badge kind={kind(r.action)}>{r.action}</Badge></td>
                    <td>{r.entity ? `${r.entity}${r.entity_id ? ` #${r.entity_id}` : ''}` : '—'}</td>
                    <td style={{ color: 'var(--muted)', fontSize: 12, maxWidth: 380 }}>{Object.entries(r.meta || {}).filter(([, v]) => v != null).map(([k, v]) => `${k}: ${v}`).join(' · ') || '—'}</td>
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
