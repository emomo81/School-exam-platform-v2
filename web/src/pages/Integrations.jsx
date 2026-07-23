import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Card, Spinner, Badge, Icon } from '../ui.jsx';

export default function Integrations() {
  const [s, setS] = useState(null);
  useEffect(() => { api.get('/api/system/status').then(setS).catch(() => setS({ ok: false })); }, []);
  if (!s) return <Spinner />;
  const rows = [
    { name: 'ExamPro API', desc: 'Express REST backend (Render analogue)', ok: s.ok, meta: `v${s.version} · uptime ${Math.round(s.uptime_sec / 60)} min` },
    { name: 'Database', desc: 'SQLite (dev) — schema ports 1:1 to Supabase Postgres', ok: true, meta: s.db },
    { name: 'Gemini AI', desc: 'Question generation + essay grading', ok: s.gemini_configured, meta: s.gemini_configured ? `model ${s.gemini_model}` : 'set GEMINI_API_KEY in .env' },
    { name: 'Realtime (live monitoring)', desc: 'Server-Sent Events channel (Supabase Realtime analogue)', ok: true, meta: 'SSE' },
    { name: 'Server timer enforcement', desc: 'Background auto-submit sweep every 15s (pg_cron analogue)', ok: true, meta: 'active' },
    { name: 'File storage', desc: 'Local uploads dir (Supabase Storage analogue)', ok: true, meta: `${s.counts?.courses ?? 0} courses · ${s.counts?.exams ?? 0} exams` },
  ];
  return (
    <div>
      <div className="page-head"><div><h1 className="page-title">Integrations</h1><div className="page-sub">Service health and platform wiring (PRD §8 stack analogues for local development).</div></div></div>
      <Card pad={false}>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Service</th><th>Purpose</th><th>Status</th><th>Detail</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name}>
                  <td className="t-strong">{r.name}</td>
                  <td>{r.desc}</td>
                  <td>{r.ok ? <Badge kind="success">connected</Badge> : <Badge kind="warn">needs config</Badge>}</td>
                  <td style={{ color: 'var(--muted)', fontSize: 12 }}>{r.meta}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
