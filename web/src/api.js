// Tiny API client. Works two ways:
//  1. Same-origin (default) — API and SPA served together (local dev, all-in-one Render).
//  2. Split-origin — set VITE_API_BASE (e.g. https://exampro-api.onrender.com) and the
//     SPA calls the API cross-origin with cookies (credentials:'include'); stored
//     Bearer tokens are sent as a fallback when third-party cookies are blocked.
const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/+$/, '');
const CROSS_ORIGIN = !!API_BASE;

export function studentToken() { return localStorage.getItem('ep_student_token') || ''; }
export function setStudentToken(t) { t ? localStorage.setItem('ep_student_token', t) : localStorage.removeItem('ep_student_token'); }
export function teacherToken() { return localStorage.getItem('ep_teacher_token') || ''; }
export function setTeacherToken(t) { t ? localStorage.setItem('ep_teacher_token', t) : localStorage.removeItem('ep_teacher_token'); }

async function request(path, { method = 'GET', body, formData, headers = {} } = {}) {
  const h = { ...headers };
  const st = studentToken();
  const tt = teacherToken();
  const isStudentApi = path.startsWith('/api/student') || path.startsWith('/api/auth/student');
  // Always send the stored Bearer token when present — cookies still work when
  // available, but this keeps auth working across split deployments (Vercel ↔ Render)
  // regardless of cross-site cookie / SameSite / proxy behavior.
  if (isStudentApi && st) h.Authorization = `Bearer ${st}`;
  else if (!isStudentApi && tt) h.Authorization = `Bearer ${tt}`;
  const init = { method, headers: h, credentials: CROSS_ORIGIN ? 'include' : 'same-origin' };
  if (formData) init.body = formData;
  else if (body !== undefined) { h['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
  const res = await fetch(API_BASE + path, init);
  const ct = res.headers.get('content-type') || '';
  let data = null;
  if (ct.includes('application/json')) data = await res.json().catch(() => null);
  else data = await res.text();
  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  get: (p) => request(p),
  post: (p, body) => request(p, { method: 'POST', body }),
  patch: (p, body) => request(p, { method: 'PATCH', body }),
  del: (p) => request(p, { method: 'DELETE' }),
  upload: (p, formData, method = 'POST') => request(p, { method, formData }),
};

// Server-Sent Events for live monitoring
export function openMonitorStream(examId, onEvent) {
  const es = new EventSource(`${API_BASE}/api/exams/${examId}/monitor/stream`, { withCredentials: CROSS_ORIGIN });
  es.onmessage = (e) => onEvent?.('message', e);
  es.addEventListener('attempt', (e) => onEvent?.('attempt', e));
  es.addEventListener('violation', (e) => onEvent?.('violation', e));
  es.addEventListener('grading', (e) => onEvent?.('grading', e));
  es.addEventListener('progress', (e) => onEvent?.('progress', e));
  return () => es.close();
}
