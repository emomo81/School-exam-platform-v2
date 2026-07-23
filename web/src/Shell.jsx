import React, { useEffect, useMemo, useState, createContext, useContext, useRef } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { api, setTeacherToken } from './api.js';
import { useAuth } from './App.jsx';
import { Icon, initials, Btn, Modal, useToast, timeAgo, fmtTime } from './ui.jsx';

const CourseCtx = createContext({ courses: [], current: null, setCurrent: () => {}, refresh: async () => {} });
export const useCourses = () => useContext(CourseCtx);

function SideItem({ to, icon, label, badge, end, onNavigate }) {
  return (
    <NavLink to={to} end={end} onClick={onNavigate} className={({ isActive }) => `side-item ${isActive ? 'active' : ''}`}>
      <Icon name={icon} size={17} /><span>{label}</span>
      {badge && <span className={`side-badge ${badge.kind || 'b-new'}`}>{badge.text}</span>}
    </NavLink>
  );
}

// Close dropdowns on outside click / Escape
function useOutside(ref, onClose) {
  useEffect(() => {
    const fn = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const esc = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', fn);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', fn); document.removeEventListener('keydown', esc); };
  }, [ref, onClose]);
}

const ACT_META = (a) => a.meta?.title || a.meta?.course || a.meta?.reason || a.meta?.exam || a.meta?.filename || '';

function NotificationsPanel({ onNavigate }) {
  const [items, setItems] = useState(null);
  useEffect(() => { api.get('/api/audit?limit=12').then(setItems).catch(() => setItems([])); }, []);
  const interesting = (a) => !a.action.startsWith('auth.') && !a.action.startsWith('export.');
  return (
    <div className="card pop-panel">
      <h4>Recent activity</h4>
      {!items ? <div className="spinner-wrap" style={{ padding: 18 }}><span className="spinner" /></div>
        : items.filter(interesting).length === 0 ? <div className="hint" style={{ padding: '8px 6px 12px' }}>Nothing new — you're all caught up.</div>
        : items.filter(interesting).slice(0, 8).map((a) => (
          <button key={a.id} className="feed-item" style={{ width: '100%', textAlign: 'left', background: 'none', border: 0, borderBottom: '1px solid var(--line-2)', cursor: 'pointer' }}
            onClick={() => onNavigate(a)}>
            <div className="feed-ic" style={{ background: a.action.includes('violation') || a.action.includes('terminated') ? '#fee2e2' : a.action.includes('ai.') ? '#ede9fe' : '#e9f0ff', color: a.action.includes('violation') || a.action.includes('terminated') ? '#b91c1c' : a.action.includes('ai.') ? '#6d28d9' : '#2563eb' }}>
              <Icon name={a.action.includes('violation') || a.action.includes('terminated') ? 'alert' : a.action.includes('ai.') ? 'sparkle' : 'zap'} size={13} />
            </div>
            <div style={{ minWidth: 0 }}>
              <b style={{ fontSize: 12 }}>{a.action}</b>
              <div style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ACT_META(a)} · {a.actor_name || a.actor_type}</div>
            </div>
            <span className="time">{timeAgo(a.created_at)}</span>
          </button>
        ))}
      <div style={{ padding: 8 }}>
        <Btn kind="ghost" size="sm" className="btn-block" onClick={() => onNavigate({ action: 'goto.audit' })}>Open full audit log →</Btn>
      </div>
    </div>
  );
}

export default function Shell() {
  const { teacher, setTeacher } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [courses, setCourses] = useState([]);
  const [current, setCurrent] = useState(() => localStorage.getItem('ep_current_course') || null);
  const [compact, setCompact] = useState(false);      // desktop icon-rail
  const [drawer, setDrawer] = useState(false);        // mobile drawer
  const [showCreate, setShowCreate] = useState(false);
  const [userMenu, setUserMenu] = useState(false);
  const [notif, setNotif] = useState(false);
  const [help, setHelp] = useState(false);
  const [badges, setBadges] = useState({ notif: 0, ai: 0 });
  const [q, setQ] = useState('');
  const searchRef = useRef(null);
  const [courseMenu, setCourseMenu] = useState(false);
  const createRef = useRef(null);
  const userRef = useRef(null);
  const notifRef = useRef(null);
  const courseRef = useRef(null);
  useOutside(createRef, () => setShowCreate(false));
  useOutside(userRef, () => setUserMenu(false));
  useOutside(notifRef, () => setNotif(false));
  useOutside(courseRef, () => setCourseMenu(false));

  // Ctrl+K / Cmd+K focuses global search (desktop)
  useEffect(() => {
    const fn = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, []);

  const refresh = async () => {
    try { setCourses(await api.get('/api/courses')); } catch { /* ignore */ }
  };
  useEffect(() => { refresh(); }, []);

  // Unread-style badges: opening the notifications panel / AI queue zeroes its
  // counter server-side; new activity raises it again on the next poll.
  const refreshBadges = () => api.get('/api/me/badges')
    .then((d) => setBadges({ notif: d.notifications || 0, ai: d.ai || 0 }))
    .catch(() => {});
  useEffect(() => { refreshBadges(); const t = setInterval(refreshBadges, 30000); return () => clearInterval(t); }, []);

  const markSeen = (target) => {
    api.post('/api/me/seen', { target }).catch(() => {});
    setBadges((b) => target === 'ai' ? { ...b, ai: 0 } : { ...b, notif: 0 });
  };

  const currentCourse = useMemo(
    () => courses.find((c) => c.id === Number(current)) || courses[0] || null,
    [courses, current]
  );

  // Topbar course switcher — sets the dashboard's course context and remembers it.
  const selectCourse = (id) => {
    setCurrent(String(id));
    localStorage.setItem('ep_current_course', String(id));
    setCourseMenu(false);
  };

  const doLogout = async () => {
    await api.post('/api/auth/teacher/logout').catch(() => {});
    setTeacherToken('');
    setTeacher(null);
    navigate('/login');
  };

  const quickCreate = (what) => {
    setShowCreate(false);
    if (what === 'course') navigate('/courses?new=1');
    if (what === 'exam') navigate('/exams?new=1');
    if (what === 'students') navigate(currentCourse ? `/courses/${currentCourse.id}?tab=roster` : '/students');
    if (what === 'ai') navigate('/ai-studio');
  };

  const onNotifNavigate = (a) => {
    setNotif(false);
    if (a.action === 'goto.audit') return navigate('/audit-logs');
    if (a.entity === 'exam' && a.entity_id) return navigate(`/exams/${a.entity_id}`);
    if (a.entity === 'course' && a.entity_id) return navigate(`/courses/${a.entity_id}`);
    if (a.action.startsWith('ai.') || a.action.startsWith('grade.')) return navigate('/ai-studio?tab=queue');
    navigate('/audit-logs');
  };

  const globalSearch = (e) => {
    if (e.key === 'Enter' && q.trim()) { navigate(`/exams?q=${encodeURIComponent(q.trim())}`); setQ(''); }
  };

  const isMobileDrawer = () => window.innerWidth <= 760;
  const toggleSidebar = () => { isMobileDrawer() ? setDrawer((v) => !v) : setCompact((v) => !v); };
  const closeDrawer = () => setDrawer(false);

  return (
    <CourseCtx.Provider value={{ courses, current: currentCourse, setCurrent, refresh }}>
      <div className={`app-shell ${compact ? 'compact' : ''}`}>
        {drawer && <div className="side-backdrop" onClick={closeDrawer} />}
        <aside className={`sidebar ${drawer ? 'open' : ''}`}>
          <div className="side-logo">
            <div className="logo-mark"><Icon name="grad" size={19} /></div>
            <div>
              <div className="logo-name">ExamPro</div>
              <div className="logo-tag">Secure. Fair. Transparent.</div>
            </div>
          </div>
          <nav className="side-nav">
            <SideItem to="/" icon="dashboard" label="Dashboard" end onNavigate={closeDrawer} />
            <div className="side-group">Academic</div>
            <SideItem to="/courses" icon="book" label="Courses" badge={{ text: 'New' }} onNavigate={closeDrawer} />
            <SideItem to="/exams" icon="exams" label="Exams" onNavigate={closeDrawer} />
            <SideItem to="/students" icon="students" label="Students" onNavigate={closeDrawer} />
            <SideItem to="/question-bank" icon="bank" label="Question Bank" onNavigate={closeDrawer} />
            <div className="side-group">AI Studio</div>
            <SideItem to="/ai-studio" icon="sparkle" label="AI Studio" onNavigate={closeDrawer} />
            <div className="side-group">Monitoring &amp; Results</div>
            <SideItem to="/monitoring" icon="monitor" label="Live Monitoring" badge={{ text: 'Live', kind: 'b-live' }} onNavigate={closeDrawer} />
            <SideItem to="/results" icon="chart" label="Results &amp; Analytics" onNavigate={closeDrawer} />
            <SideItem to="/reports" icon="report" label="Reports" onNavigate={closeDrawer} />
            <div className="side-group">System</div>
            <SideItem to="/settings" icon="settings" label="Settings" onNavigate={closeDrawer} />
            <SideItem to="/integrations" icon="plug" label="Integrations" onNavigate={closeDrawer} />
            <SideItem to="/audit-logs" icon="audit" label="Audit Logs" onNavigate={closeDrawer} />
          </nav>
          <div className="side-bottom">
            <div className="sys-status"><span className="live-dot" /> System Status</div>
            <div className="uptime-row"><span>All Systems Operational</span></div>
            <div className="uptime-row"><span>Uptime · Since 30 days ago</span><b>99.98%</b></div>
            <div style={{ position: 'relative' }} ref={userRef}>
              <button className="user-chip" onClick={() => setUserMenu((v) => !v)}>
                <div className="avatar">{initials(teacher?.name)}</div>
                <div className="uc-text">
                  <div className="u-name">{teacher?.name}</div>
                  <div className="u-role">{teacher?.role === 'admin' ? 'Administrator' : 'Instructor'}</div>
                </div>
                <Icon name="chevD" size={15} />
              </button>
              {userMenu && (
                <div className="card" style={{ position: 'absolute', bottom: 52, left: 0, right: 0, padding: 6, zIndex: 130 }}>
                  <Btn kind="ghost" size="sm" icon="user" onClick={() => { setUserMenu(false); navigate('/settings'); }}>Profile &amp; Settings</Btn>
                  <Btn kind="ghost" size="sm" icon="logout" onClick={doLogout}>Sign out</Btn>
                </div>
              )}
            </div>
          </div>
        </aside>

        <div className="main">
          <header className="topbar">
            <button className="icon-btn hamb" title="Toggle sidebar" onClick={toggleSidebar}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
            </button>
            <div className="search">
              <Icon name="search" size={15} />
              <input ref={searchRef} placeholder="Search exams…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={globalSearch} />
              <span className="kbd">Ctrl + K</span>
            </div>
            <div className="topbar-spacer" />
            <div style={{ position: 'relative' }} ref={notifRef}>
              <button className="icon-btn" title="Notifications" onClick={() => { const opening = !notif; setNotif(opening); if (opening) markSeen('notifications'); }}>
                <Icon name="bell" size={17} />
                {badges.notif > 0 && <span className="n-dot">{badges.notif > 99 ? '99+' : badges.notif}</span>}
              </button>
              {notif && <NotificationsPanel onNavigate={onNotifNavigate} />}
            </div>
            <button className="icon-btn" title="AI Review queue" onClick={() => { markSeen('ai'); navigate('/ai-studio?tab=queue'); }}>
              <Icon name="sparkle" size={17} />
              {badges.ai > 0 && <span className="n-dot" style={{ background: '#f59e0b' }}>{badges.ai > 9 ? '9+' : badges.ai}</span>}
            </button>
            <button className="icon-btn" title="Help & shortcuts" onClick={() => setHelp(true)}>
              <Icon name="help" size={17} />
            </button>
            <div style={{ position: 'relative' }} ref={courseRef}>
              <button className="course-select" onClick={() => setCourseMenu((v) => !v)} title="Switch current course">
                <Icon name="book" size={15} />
                <div><small>Current Course</small><b>{currentCourse ? `${currentCourse.code} – ${currentCourse.term}` : 'No courses yet'}</b></div>
                <Icon name="chevD" size={14} />
              </button>
              {courseMenu && (
                <div className="card course-panel">
                  <h4>Switch current course</h4>
                  {courses.length === 0 && <div className="hint" style={{ padding: '6px 6px 10px' }}>No courses yet — create one first.</div>}
                  {courses.map((c) => (
                    <button key={c.id} className={`course-opt ${currentCourse?.id === c.id ? 'cur' : ''}`} onClick={() => selectCourse(c.id)}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <b>{c.code} – {c.term}</b>
                        <div className="co-sub">{c.title}</div>
                      </div>
                      {currentCourse?.id === c.id && <Icon name="check" size={14} style={{ color: 'var(--blue)', flex: 'none' }} />}
                    </button>
                  ))}
                  <div style={{ padding: 8, borderTop: '1px solid var(--line-2)', marginTop: 4 }}>
                    <Btn kind="ghost" size="sm" className="btn-block" onClick={() => { setCourseMenu(false); navigate('/courses'); }}>Manage all courses →</Btn>
                  </div>
                </div>
              )}
            </div>
            <div style={{ position: 'relative' }} ref={createRef}>
              <Btn kind="primary" icon="plus" onClick={() => setShowCreate((v) => !v)}>Create <Icon name="chevD" size={13} /></Btn>
              {showCreate && (
                <div className="card" style={{ position: 'absolute', right: 0, top: 46, width: 220, padding: 6, zIndex: 90 }}>
                  {[['course', 'New Course', 'courses'], ['exam', 'New Exam', 'exams'], ['students', 'Add Students', 'students'], ['ai', 'AI Question Generation', 'sparkle']].map(([k, l, ic]) => (
                    <button key={k} className="side-item" onClick={() => quickCreate(k)}><Icon name={ic} size={15} /><span>{l}</span></button>
                  ))}
                </div>
              )}
            </div>
          </header>
          <main className="page">
            <Outlet />
          </main>
        </div>
      </div>

      <Modal open={help} onClose={() => setHelp(false)} title="Help & keyboard shortcuts">
        <div className="kv"><span><span className="kbd">Ctrl + K</span> Global exam search</span><b>works anywhere</b></div>
        <div className="kv"><span>Sidebar</span><b>hamburger collapses to icons (drawer on mobile)</b></div>
        <div className="kv"><span>Live exam</span><b>Monitoring → student grid updates via SSE</b></div>
        <div className="kv"><span>Anti-cheat</span><b>3-strike policy configurable per exam</b></div>
        <div className="kv"><span>AI Studio</span><b>needs GEMINI_API_KEY in exampro/.env</b></div>
        <div className="kv"><span>Student check-in</span><b>/exam — roll number + access code</b></div>
        <div className="hint" style={{ marginTop: 10 }}>Full documentation lives in <code>exampro/README.md</code>.</div>
      </Modal>
    </CourseCtx.Provider>
  );
}
