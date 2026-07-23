import React, { useEffect, useRef, useState } from 'react';

// ------------------------------- Icons --------------------------------------
const PATHS = {
  dashboard: <><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></>,
  courses: <path d="M4 19.5A2.5 2.5 0 016.5 17H20M4 19.5A2.5 2.5 0 006.5 22H20V2H6.5A2.5 2.5 0 004 4.5v15z"/>,
  exams: <><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></>,
  students: <><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></>,
  bank: <><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3M12 17h.01"/></>,
  sparkle: <><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.9 2.6L22.5 18.5l-2.6.9L19 22l-.9-2.6-2.6-.9 2.6-.9z"/></>,
  monitor: <><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></>,
  chart: <><path d="M3 3v18h18"/><path d="M7 16l4-6 4 4 5-8"/></>,
  report: <><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/><path d="M9 15l2 2 4-4"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33h0a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51h0a1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82v0a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z"/></>,
  plug: <><path d="M9 2v6M15 2v6M6.5 8h11v3a5.5 5.5 0 01-11 0z"/><path d="M12 16.5V22"/></>,
  audit: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></>,
  bell: <><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></>,
  help: <><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3M12 17h.01"/></>,
  search: <><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></>,
  plus: <path d="M12 5v14M5 12h14"/>,
  chevD: <path d="M6 9l6 6 6-6"/>,
  chevL: <path d="M15 18l-6-6 6-6"/>,
  chevR: <path d="M9 18l6-6-6-6"/>,
  alert: <><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><path d="M12 9v4M12 17h.01"/></>,
  check: <path d="M20 6L9 17l-5-5"/>,
  x: <path d="M18 6L6 18M6 6l12 12"/>,
  download: <><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><path d="M7 10l5 5 5-5M12 15V3"/></>,
  upload: <><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><path d="M17 8l-5-5-5 5M12 3v12"/></>,
  trash: <><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"/></>,
  edit: <><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4z"/></>,
  eye: <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>,
  clock: <><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></>,
  calendar: <><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></>,
  flag: <><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/></>,
  zap: <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>,
  user: <><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></>,
  logout: <><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/></>,
  wifi: <><path d="M5 12.55a11 11 0 0114.08 0M8.53 16.11a6 6 0 016.95 0M12 20h.01M1.42 9a16 16 0 0121.16 0"/></>,
  shield: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></>,
  heart: <><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></>,
  file: <><path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/><path d="M13 2v7h7"/></>,
  refresh: <><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></>,
  send: <><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/></>,
  lock: <><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></>,
  grad: <><path d="M22 10L12 5 2 10l10 5 10-5z"/><path d="M6 12v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5"/></>,
  essay: <><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4z"/></>,
  rubric: <><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></>,
  play: <path d="M5 3l14 9-14 9V3z"/>,
  users2: <><circle cx="9" cy="8" r="3.5"/><path d="M1.5 20v-1.5A4.5 4.5 0 016 14h6a4.5 4.5 0 014.5 4.5V20"/><circle cx="17.5" cy="9" r="2.5"/><path d="M22.5 20v-1a4 4 0 00-2-3.46"/></>,
  copy: <><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></>,
  book: <><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/></>,
};

export function Icon({ name, size = 18, className = '', strokeWidth = 1.9 }) {
  return (
    <svg className={`ic ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name] || PATHS.help}
    </svg>
  );
}

// ------------------------------ Formatters ----------------------------------
export const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2, '0')}, ${d.getFullYear()}`;
}
export function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  let h = d.getHours(); const m = String(d.getMinutes()).padStart(2, '0');
  const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
  return `${String(h).padStart(2, '0')}:${m} ${ap}`;
}
export function fmtDateTime(iso) { return `${fmtDate(iso)} · ${fmtTime(iso)}`; }
export function timeAgo(iso) {
  if (!iso) return '—';
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return `${Math.round(s)} sec ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} hr ago`;
  return `${Math.round(s / 86400)} days ago`;
}
export function fmtDur(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}
export function initials(name) {
  return String(name || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
}

// ------------------------------ Primitives ----------------------------------
export function Card({ title, action, children, className = '', pad = true }) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && (
        <header className="card-hd">
          <h3 className="card-title">{title}</h3>
          {action}
        </header>
      )}
      <div className={pad ? 'card-bd' : ''}>{children}</div>
    </section>
  );
}

export function Badge({ kind = 'muted', children, dot = false }) {
  return <span className={`badge b-${kind}`}>{dot && <span className="b-dot" />}{children}</span>;
}

export const statusBadge = (s) => ({
  live: <Badge kind="live" dot>Live</Badge>,
  scheduled: <Badge kind="scheduled">Scheduled</Badge>,
  ended: <Badge kind="muted">Ended</Badge>,
  submitted: <Badge kind="success">Submitted</Badge>,
  auto_submitted: <Badge kind="info">Auto-submitted</Badge>,
  terminated: <Badge kind="danger">Terminated</Badge>,
  in_progress: <Badge kind="live" dot>In progress</Badge>,
  active: <Badge kind="live" dot>Active</Badge>,
  disconnected: <Badge kind="warn">Disconnected</Badge>,
  not_started: <Badge kind="muted">Not started</Badge>,
}[s] || <Badge kind="muted">{s}</Badge>);

export function Btn({ children, kind = 'default', size, icon, className = '', ...rest }) {
  return (
    <button className={`btn btn-${kind} ${size ? `btn-${size}` : ''} ${className}`} {...rest}>
      {icon && <Icon name={icon} size={size === 'sm' ? 14 : 16} />}{children}
    </button>
  );
}

export function Spinner({ label = 'Loading…' }) {
  return <div className="spinner-wrap"><span className="spinner" /> {label}</div>;
}

export function Empty({ icon = 'file', title, hint, action }) {
  return (
    <div className="empty">
      <div className="empty-ic"><Icon name={icon} size={26} /></div>
      <div className="empty-title">{title}</div>
      {hint && <div className="empty-hint">{hint}</div>}
      {action}
    </div>
  );
}

export function Field({ label, hint, children }) {
  return (
    <label className="field">
      {label && <span className="label">{label}</span>}
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

export function Seg({ options, value, onChange }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={o.value} type="button" className={`seg-btn ${value === o.value ? 'on' : ''}`}
          onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer, wide }) {
  useEffect(() => {
    if (!open) return;
    const fn = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-mask" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`}>
        <header className="modal-hd">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </header>
        <div className="modal-bd">{children}</div>
        {footer && <footer className="modal-ft">{footer}</footer>}
      </div>
    </div>
  );
}

// ------------------------------ Charts --------------------------------------
export function Donut({ size = 150, thickness = 20, parts, center }) {
  const r = (size - thickness) / 2, c = 2 * Math.PI * r;
  const total = Math.max(1, parts.reduce((s, p) => s + p.value, 0));
  let offset = 0;
  return (
    <div className="donut-wrap" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#eef2f9" strokeWidth={thickness} />
        {parts.map((p, i) => {
          const frac = p.value / total;
          const dash = `${frac * c} ${c}`;
          const off = -offset * c + c * 0.25;
          offset += frac;
          return <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={p.color}
            strokeWidth={thickness} strokeDasharray={dash} strokeDashoffset={off} strokeLinecap="butt" />;
        })}
      </svg>
      <div className="donut-center">{center}</div>
    </div>
  );
}

export function Ring({ pct = 0, size = 76, thickness = 7, color = '#16a34a', children }) {
  const r = (size - thickness) / 2, c = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, pct / 100));
  return (
    <div className="ring-wrap" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#eef2f9" strokeWidth={thickness} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={thickness}
          strokeDasharray={`${frac * c} ${c}`} strokeDashoffset={c * 0.25} strokeLinecap="round" />
      </svg>
      <div className="ring-center">{children}</div>
    </div>
  );
}

export function SparkArea({ points, width = 560, height = 130, color = '#16a34a' }) {
  if (!points?.length) return <div className="spark-empty">No samples yet today</div>;
  const max = Math.max(...points.map((p) => p.n)) * 1.15 || 1;
  const stepX = width / Math.max(1, points.length - 1);
  const coords = points.map((p, i) => [i * stepX, height - (p.n / max) * (height - 14)]);
  const path = coords.map(([x, y], i) => {
    if (i === 0) return `M ${x},${y}`;
    const [px, py] = coords[i - 1];
    const cx = (px + x) / 2;
    return `C ${cx},${py} ${cx},${y} ${x},${y}`;
  }).join(' ');
  const area = `${path} L ${width},${height} L 0,${height} Z`;
  const hours = points.map((p, i) => ({ i, h: new Date(p.ts).getHours() }))
    .filter((v, idx, arr) => idx === 0 || v.h !== arr[idx - 1].h);
  return (
    <div>
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="spark">
        <defs>
          <linearGradient id="sparkfill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.22" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#sparkfill)" />
        <path d={path} fill="none" stroke={color} strokeWidth="2.2" />
        {coords.map(([x, y], i) => (i % Math.ceil(coords.length / 14) === 0 ? <circle key={i} cx={x} cy={y} r="3" fill="#fff" stroke={color} strokeWidth="2" /> : null))}
      </svg>
      <div className="spark-x">
        {hours.slice(0, 7).map((v) => <span key={v.i}>{String(v.h).padStart(2, '0')}:00</span>)}
        <span>Now</span>
      </div>
    </div>
  );
}

export function Bars({ values, color = '#2563eb', height = 120 }) {
  const max = Math.max(1, ...values);
  return (
    <div className="bars" style={{ height }}>
      {values.map((v, i) => (
        <div key={i} className="bar-col" title={`${(i) * 10}–${i * 10 + 9}%: ${v}`}>
          <div className="bar" style={{ height: `${(v / max) * 100}%`, background: color }} />
          <span className="bar-x">{i === 9 ? '90+' : i * 10}</span>
        </div>
      ))}
    </div>
  );
}

export function ProgressBar({ pct, color = '#2563eb', thin }) {
  return (
    <div className={`progress ${thin ? 'progress-thin' : ''}`}>
      <div style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }} />
    </div>
  );
}

// ----------------------------- Toast context ---------------------------------
import { createContext, useContext, useCallback } from 'react';
const ToastCtx = createContext(() => {});
export function useToast() { return useContext(ToastCtx); }

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((msg, kind = 'ok') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            <Icon name={t.kind === 'err' ? 'alert' : 'check'} size={15} /><span>{t.msg}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// Debounce helper
export function useDebounced(value, delay = 400) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), delay); return () => clearTimeout(t); }, [value, delay]);
  return v;
}
