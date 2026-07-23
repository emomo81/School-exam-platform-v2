import crypto from 'node:crypto';
import { q, nowIso } from '../db/index.js';

export const iso = (d) => new Date(d).toISOString();
export const minutesAgo = (n) => iso(Date.now() - n * 60000);
export const minutesFromNow = (n) => iso(Date.now() + n * 60000);
export const daysFromNow = (n, h = 9, m = 0) => {
  const d = new Date(Date.now() + n * 86400000);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

export const token = () => crypto.randomBytes(32).toString('hex');
export const accessCode = (prefix = 'EP') =>
  `${prefix}-${crypto.randomInt(1000, 9999)}-${crypto.randomInt(100, 999)}`;

// Deterministic PRNG (mulberry32) for reproducible seeding + fair shuffles
export function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function shuffled(arr, rand = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function examEnd(exam) {
  return new Date(new Date(exam.start_at).getTime() + exam.duration_min * 60000).toISOString();
}
export function examStatus(exam, questionCount = null) {
  const now = Date.now();
  const start = Date.parse(exam.start_at);
  const end = start + exam.duration_min * 60000;
  if (exam.force_closed_at) return 'ended';
  if (now < start) return 'scheduled';
  if (now >= start && now < end) return 'live';
  return 'ended';
}

export const VIOLATION_TYPES = {
  tab_blur: 'Tab Switch / Window Blur',
  fullscreen_exit: 'Fullscreen Exit',
  back_nav: 'Back Navigation Attempt',
  right_click: 'Right Click Attempt',
  copy_paste: 'Copy / Paste',
  print_screen: 'Print Screen',
  devtools: 'Dev Tools Detected',
};

export function audit(actorType, actorId, action, entity, entityId, meta = {}) {
  q.run(
    `INSERT INTO audit_logs (actor_type, actor_id, action, entity, entity_id, meta_json, created_at)
     VALUES (?,?,?,?,?,?,?)`,
    actorType, actorId ?? null, action, entity ?? null, entityId ?? null,
    JSON.stringify(meta), nowIso()
  );
}

// ---- CSV helpers ------------------------------------------------------------
export function parseCsv(text) {
  const rows = [];
  let row = [], cur = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
      } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.some((v) => v.trim() !== '')) rows.push(row);
      row = [];
    } else cur += c;
  }
  row.push(cur);
  if (row.some((v) => v.trim() !== '')) rows.push(row);
  return rows;
}
export function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function toCsv(rows) {
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
}

export function send(res, status, body) { res.status(status).json(body); }
export function bad(res, msg, status = 400) { res.status(status).json({ error: msg }); }
export function parseJson(s, fallback = null) { try { return JSON.parse(s); } catch { return fallback; } }

export const fmtPct = (score, max) => (max > 0 ? Math.round((score / max) * 1000) / 10 : 0);
