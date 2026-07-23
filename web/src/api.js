// Tiny API client. Same-origin cookies carry sessions; a stored student token
// is also sent as Bearer for robustness across dev ports.
export function studentToken() { return localStorage.getItem('ep_student_token') || ''; }
export function setStudentToken(t) { t ? localStorage.setItem('ep_student_token', t) : localStorage.removeItem('ep_student_token'); }

async function request(path, { method = 'GET', body, formData, headers = {} } = {}) {
  const h = { ...headers };
  const t = studentToken();
  if (t) h.Authorization = `Bearer ${t}`;
  const init = { method, headers: h, credentials: 'same-origin' };
  if (formData) init.body = formData;
  else if (body !== undefined) { h['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
  const res = await fetch(path, init);
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
  const es = new EventSource(`/api/exams/${examId}/monitor/stream`);
  es.onmessage = (e) => onEvent?.('message', e);
  es.addEventListener('attempt', (e) => onEvent?.('attempt', e));
  es.addEventListener('violation', (e) => onEvent?.('violation', e));
  es.addEventListener('grading', (e) => onEvent?.('grading', e));
  es.addEventListener('progress', (e) => onEvent?.('progress', e));
  return () => es.close();
}
