import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../App.jsx';
import {
  Card, Badge, Btn, Icon, Donut, Ring, SparkArea, Spinner, Empty,
  fmtDate, fmtTime, fmtDur, timeAgo, statusBadge,
} from '../ui.jsx';

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function Stat({ icon, num, label, sub, tint }) {
  return (
    <Card className="stat-card" pad={false}>
      <div className="stat">
        <div className="stat-icon" style={{ background: tint.bg, color: tint.fg }}><Icon name={icon} size={19} /></div>
        <div style={{ minWidth: 0 }}>
          <div className="stat-num">{num}</div>
          <div className="stat-label">{label}</div>
          <div className="stat-sub">{sub}</div>
        </div>
      </div>
    </Card>
  );
}

export default function Dashboard() {
  const { teacher } = useAuth();
  const navigate = useNavigate();
  const [d, setD] = useState(null);
  const load = () => api.get('/api/dashboard/summary').then(setD).catch(() => {});
  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);

  if (!d) return <Spinner label="Loading dashboard…" />;
  const s = d.stats;
  const ib = d.integrity_breakdown;

  const ACT_ICON = {
    'exam.created': ['plus', '#e9f0ff', '#2563eb'],
    'roster.csv_imported': ['users2', '#ede9fe', '#6d28d9'],
    'ai.questions_generated': ['sparkle', '#e0f2fe', '#0284c7'],
    'results.published': ['file', '#dcfce7', '#15803d'],
    'exam.auto_submitted': ['alert', '#fee2e2', '#b91c1c'],
    'violation.tab_blur': ['alert', '#fef3c7', '#b45309'],
    'ai.question_approved': ['check', '#dcfce7', '#15803d'],
  };
  const actLabel = (a) => ({
    'exam.created': 'New exam created',
    'roster.csv_imported': '15 students registered',
    'ai.questions_generated': 'AI questions generated',
    'results.published': 'Results published',
    'exam.auto_submitted': 'Student flagged',
    'grade.override': 'AI score overridden',
  }[a.action] || a.action);
  const actMeta = (a) => a.meta?.title || a.meta?.course || a.meta?.reason || a.meta?.exam || '';

  return (
    <div>
      {/* Greeting */}
      <div className="page-head">
        <div>
          <h1 className="page-title">{greeting()}, {teacher?.name?.split(' ')[0]}! 👋</h1>
          <div className="page-sub">Here's what's happening in your courses today.</div>
        </div>
      </div>

      {/* Stat cards */}
      <div className="stats-grid" style={{ marginBottom: 16 }}>
        <Stat icon="monitor" num={s.active_courses} label="Active Courses" sub={`${s.courses_ending_soon} ending soon`} tint={{ bg: '#e9f0ff', fg: '#2563eb' }} />
        <Stat icon="exams" num={s.upcoming_exams} label="Upcoming Exams" sub={`${s.exams_this_week} this week`} tint={{ bg: '#e9f0ff', fg: '#2563eb' }} />
        <Stat icon="students" num={s.students} label="Students" sub="Across all courses" tint={{ bg: '#e9f0ff', fg: '#4f46e5' }} />
        <Stat icon="chart" num={s.avg_score != null ? `${Math.round(s.avg_score)}%` : '—'} label="Average Score"
          sub={s.avg_score_trend != null ? <span className={s.avg_score_trend >= 0 ? 'trend-up' : 'trend-down'}>↑ {Math.abs(s.avg_score_trend)}% vs last month</span> : 'Across all courses'}
          tint={{ bg: '#dcfce7', fg: '#16a34a' }} />
        <Stat icon="shield" num={`${Math.round(s.integrity)}%`} label="Integrity Score" sub="Excellent" tint={{ bg: '#dcfce7', fg: '#16a34a' }} />
        <Stat icon="sparkle" num={s.ai_pending} label="AI Suggestions" sub="Needs review" tint={{ bg: '#ede9fe', fg: '#6d28d9' }} />
      </div>

      <div className="dash-cols">
        {/* ======================= LEFT ======================= */}
        <div className="dash-main">
          <div className="dash-2">
            {/* Upcoming exams */}
            <Card title="Upcoming Exams" action={<Link className="link" to="/exams">View Calendar</Link>}>
              {d.upcoming.length === 0 && <Empty icon="calendar" title="No upcoming exams" hint="Schedule one under Exams → New Exam." />}
              {d.upcoming.map((e) => (
                <div className="exam-row" key={e.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/exams/${e.id}`)}>
                  <div className="er-ic"><Icon name="file" size={16} /></div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <b>{e.title}</b>
                    <small>{e.course}</small>
                    <small style={{ display: 'block' }}>{fmtDate(e.start_at)} · {fmtTime(e.start_at)}</small>
                  </div>
                  <div>
                    <div className="er-num">{e.students}</div>
                    <div className="er-st">Students</div>
                  </div>
                  {statusBadge(e.status)}
                </div>
              ))}
            </Card>

            {/* Live overview */}
            <Card title="Live Overview" action={<Link className="link" to="/monitoring">View Monitoring</Link>}>
              <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontSize: 30, fontWeight: 800, color: 'var(--ink)', letterSpacing: '-0.02em' }}>{d.live_overview.online}</div>
                  <div className="stat-sub">Students Online</div>
                </div>
                <div style={{ marginLeft: 'auto', display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12 }}>
                  <span><span className="sw" style={{ background: '#16a34a', width: 8, height: 8, borderRadius: '50%', display: 'inline-block', marginRight: 6 }} /><b>{d.live_overview.active}</b> Active</span>
                  <span><span className="sw" style={{ background: '#f59e0b', width: 8, height: 8, borderRadius: '50%', display: 'inline-block', marginRight: 6 }} /><b>{d.live_overview.warning}</b> Warning</span>
                  <span><span className="sw" style={{ background: '#ef4444', width: 8, height: 8, borderRadius: '50%', display: 'inline-block', marginRight: 6 }} /><b>{d.live_overview.violations}</b> Violations</span>
                </div>
              </div>
              <SparkArea points={d.live_overview.series} height={120} />
              <div className="grid" style={{ gridTemplateColumns: 'repeat(4,1fr)', marginTop: 10 }}>
                {[['Exams Live', d.live_overview.exams_live, 'var(--ink)'], ['Paused', d.live_overview.paused, 'var(--ink)'],
                  ['Ending Soon', d.live_overview.ending_soon, '#f59e0b'], ['Critical Alerts', d.live_overview.critical, '#ef4444']].map(([l, v, c]) => (
                  <div key={l} style={{ textAlign: 'left' }}>
                    <div style={{ fontSize: 20, fontWeight: 800, color: c, textDecoration: l === 'Ending Soon' ? 'underline dotted' : 'none' }}>{v}</div>
                    <div className="stat-sub">{l}{l === 'Ending Soon' && <small style={{ display: 'block' }}>&lt; 15 min</small>}</div>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {/* Course performance */}
          <Card title="Course Performance Overview" action={<Link className="link" to="/courses">View All Courses</Link>}>
            <div className="scroller">
              {d.course_performance.slice(0, 6).map((c) => (
                <div className="card course-card" key={c.id} style={{ cursor: 'pointer', width: 235 }} onClick={() => navigate(`/courses/${c.id}`)}>
                  <div>
                    <div className="cc-code" style={{ color: c.color }}>{c.code}</div>
                    <div className="cc-name">{c.title}</div>
                    <div className="cc-name">{c.term}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      <div className="stat-sub" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span className="sw" style={{ width: 8, height: 8, borderRadius: '50%', background: c.color, display: 'inline-block' }} /> Avg. Score
                      </div>
                      {c.trend != null && <span className={c.trend >= 0 ? 'trend-up' : 'trend-down'} style={{ fontSize: 11.5 }}>{c.trend >= 0 ? '↑' : '↓'} {Math.abs(c.trend)}%</span>}
                    </div>
                    <Ring pct={c.avg ?? 0} color={c.color} size={64} thickness={7}>
                      <b style={{ fontSize: 15, color: 'var(--ink)' }}>{c.avg != null ? `${c.avg}%` : '—'}</b>
                    </Ring>
                  </div>
                  <div className="cc-foot">
                    <span><b>{c.exams}</b> Exams</span>
                    <span><b>{c.students}</b> Students</span>
                  </div>
                </div>
              ))}
              <div className="card course-card" style={{ justifyContent: 'center', alignItems: 'center', cursor: 'pointer', borderStyle: 'dashed', width: 200, minHeight: 170 }}
                onClick={() => navigate('/courses?new=1')}>
                <Icon name="plus" size={22} className="empty-ic" style={{ margin: 0 }} />
                <b style={{ color: 'var(--blue)', fontSize: 12.5 }}>Create New Course</b>
              </div>
            </div>
          </Card>

          {/* Activity / integrity / violations */}
          <div className="dash-3">
            <Card title="Recent Activity">
              {d.activity.map((a) => {
                const [ic, bg, fg] = ACT_ICON[a.action] || ['zap', '#f1f5f9', '#64748b'];
                return (
                  <div className="feed-item" key={a.id}>
                    <div className="feed-ic" style={{ background: bg, color: fg }}><Icon name={ic} size={14} /></div>
                    <div>
                      <b>{actLabel(a)}</b>
                      <div style={{ color: 'var(--muted)', fontSize: 11.5 }}>{actMeta(a)}</div>
                    </div>
                    <span className="time">{timeAgo(a.created_at)}</span>
                  </div>
                );
              })}
            </Card>

            <Card title={<>Integrity Overview <span style={{ color: 'var(--muted)', fontWeight: 500, fontSize: 11 }}>(Last 7 Days)</span></>}>
              <div style={{ display: 'flex', justifyContent: 'center', padding: '6px 0 10px' }}>
                <Donut size={140} thickness={19}
                  parts={[
                    { value: ib.no_issues, color: '#16a34a' },
                    { value: ib.warnings, color: '#f59e0b' },
                    { value: ib.violations, color: '#ef4444' },
                  ]}
                  center={<div><div style={{ fontSize: 24, fontWeight: 800, color: 'var(--ink)' }}>{Math.round(ib.integrity)}%</div><div style={{ fontSize: 10.5, color: 'var(--muted)' }}>Integrity Score</div></div>}
                />
              </div>
              {[
                ['No Issues', ib.no_issues, '#16a34a'],
                ['Warnings', ib.warnings, '#f59e0b'],
                ['Violations', ib.violations, '#ef4444'],
              ].map(([l, v, c]) => {
                const tot = Math.max(1, ib.no_issues + ib.warnings + ib.violations);
                return (
                  <div className="legend-row" key={l}>
                    <span className="sw" style={{ background: c }} />{l}
                    <b>{v} ({Math.round((v / tot) * 100)}%)</b>
                  </div>
                );
              })}
            </Card>

            <Card title="Top Violation Types">
              {d.top_violations.length === 0 && <Empty icon="shield" title="No violations recorded" hint="Clean week so far." />}
              {d.top_violations.map((v, i) => (
                <div className="vbar-row" key={v.type}>
                  <span>{v.label}</span>
                  <div className="progress progress-thin"><div style={{ width: `${v.pct}%`, background: ['#ef4444', '#f59e0b', '#f59e0b', '#2563eb', '#8b5cf6'][i % 5] }} /></div>
                  <b style={{ textAlign: 'right', color: 'var(--ink)' }}>{v.n} ({v.pct}%)</b>
                </div>
              ))}
            </Card>
          </div>
        </div>

        {/* ======================= RIGHT RAIL ======================= */}
        <div className="grid" style={{ gap: 16 }}>
          <Card title="AI Review Queue" action={<Link className="link" to="/ai-studio?tab=queue">View All</Link>}>
            {d.ai_queue.map((r) => (
              <div className="queue-row" key={r.kind}>
                <div className="feed-ic" style={{
                  background: { essay: '#fef3c7', sparkle: '#ede9fe', rubric: '#e0f2fe', alert: '#fee2e2' }[r.icon],
                  color: { essay: '#b45309', sparkle: '#6d28d9', rubric: '#0369a1', alert: '#b91c1c' }[r.icon],
                }}><Icon name={r.icon} size={14} /></div>
                <div><b>{r.label}</b><small>&nbsp;</small></div>
                <span className="q-count">{r.pending} {r.unit} <span style={{ color: r.pending ? '#ef4444' : 'var(--faint)' }}>●</span></span>
              </div>
            ))}
            <div style={{ paddingTop: 12 }}>
              <Btn kind="outline" className="btn-block" icon="sparkle" onClick={() => navigate('/ai-studio')}>Go to AI Studio</Btn>
            </div>
          </Card>

          <Card title="Live Exams" action={<Link className="link" to="/monitoring">View All</Link>}>
            {d.live_exams.length === 0 && <Empty icon="monitor" title="Nothing live right now" />}
            {d.live_exams.slice(0, 3).map((e) => (
              <div key={e.id} style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 11, marginBottom: 10, cursor: 'pointer' }}
                onClick={() => navigate(`/monitoring/${e.id}`)}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <b style={{ color: 'var(--ink)', fontSize: 13 }}>{e.title}</b>
                  {e.status === 'live' ? <Badge kind="live" dot>LIVE</Badge> : null}
                </div>
                {e.status === 'live' ? (
                  <small style={{ color: 'var(--muted)', fontSize: 11 }}>
                    Started {fmtTime(e.started_at)} · Ends {fmtTime(e.ends_at)} · <b style={{ color: '#15803d' }}>Remaining <LiveCountdown endsAt={e.ends_at} /></b>
                  </small>
                ) : (
                  <small style={{ color: 'var(--muted)', fontSize: 11 }}>Starts in {fmtDur(e.starts_in_ms).slice(0, 5)} · {fmtTime(e.starts_at)}</small>
                )}
              </div>
            ))}
            <Btn kind="outline" className="btn-block" icon="monitor" onClick={() => navigate('/monitoring')}>Go to Live Monitoring</Btn>
          </Card>

          <CalendarCard initial={d.calendar} navigate={navigate} />
        </div>
      </div>

      {/* Quick actions bar removed per user request — creation shortcuts live in the topbar Create menu. */}
    </div>
  );
}

function CalendarCard({ initial, navigate }) {
  const [offset, setOffset] = useState(0);
  const [items, setItems] = useState(initial);
  const [weekStart, setWeekStart] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (offset === 0) setItems(initial); }, [initial, offset]);
  useEffect(() => {
    let dead = false;
    setBusy(true);
    api.get(`/api/dashboard/calendar?offset=${offset}`).then((r) => {
      if (dead) return;
      setWeekStart(r.week_start);
      if (offset !== 0) setItems(r.items);
    }).catch(() => {}).finally(() => !dead && setBusy(false));
    return () => { dead = true; };
  }, [offset]);

  const label = (() => {
    const s = weekStart ? new Date(weekStart) : new Date();
    const e = new Date(s.getTime() + 6 * 86400e3);
    const fmt = (d) => `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()]} ${d.getDate()}`;
    return `${fmt(s)} – ${fmt(e)}, ${e.getFullYear()}`;
  })();

  return (
    <Card title="Calendar" action={<Link className="link" to="/exams">View Full Calendar</Link>}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <b style={{ fontSize: 12.5, color: 'var(--ink)', opacity: busy ? 0.5 : 1 }}>{label}</b>
        <span>
          <button className="icon-btn" style={{ width: 26, height: 26 }} title="Previous week" onClick={() => setOffset((o) => o - 1)}><Icon name="chevL" size={13} /></button>
          {offset !== 0 && <button className="link" style={{ fontSize: 10.5 }} onClick={() => setOffset(0)}>today</button>}
          <button className="icon-btn" style={{ width: 26, height: 26 }} title="Next week" onClick={() => setOffset((o) => o + 1)}><Icon name="chevR" size={13} /></button>
        </span>
      </div>
      {items.length === 0 && <div className="hint" style={{ padding: '14px 0' }}>No exams this week.</div>}
      {items.map((e) => (
        <div className="cal-row" key={e.id} style={{ cursor: 'pointer', opacity: busy ? 0.5 : 1 }} onClick={() => navigate(`/exams/${e.id}`)}>
          <span className="cal-date">{fmtDate(e.start_at).slice(0, 6)}</span>
          <span className="cal-dot" style={{ background: e.status === 'live' ? '#16a34a' : (e.color || '#2563eb') }} />
          <span style={{ flex: 1, color: 'var(--body)' }}>{e.title}</span>
          <b style={{ color: 'var(--ink)', fontSize: 11.5 }}>{fmtTime(e.start_at)}</b>
        </div>
      ))}
    </Card>
  );
}

function LiveCountdown({ endsAt }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, []);
  const ms = Math.max(0, Date.parse(endsAt) - Date.now());
  return <span>{fmtDur(ms)}</span>;
}
