// ExamPro data layer — one async API (`q.get/all/run`, `tx`) over two backends:
//   • SQLite (better-sqlite3) — default, zero-config, used locally + Track A on Render.
//   • Postgres (pg)          — enabled when DATABASE_URL is set (Supabase, Track B).
//
// The public surface is IDENTICAL and ALWAYS async, so every call site does
// `await q.get(...)` regardless of backend. SQL is written once in SQLite dialect;
// the Postgres adapter translates on the fly:
//   - positional `?`         → `$1, $2, …`
//   - `INSERT OR IGNORE`     → `INSERT … ON CONFLICT DO NOTHING`
//   - INSERTs get `RETURNING id` appended so `run()` can report `lastInsertRowid`
// Type parsers keep Postgres results shaped like SQLite (timestamptz → ISO string,
// int8/numeric → JS number).
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const USE_PG = !!config.databaseUrl;
export const nowIso = () => new Date().toISOString();

// Live ESM bindings — reassigned inside initDb(), seen by all importers.
export let q = null;    // { get, all, run } — async
export let tx = null;   // async (fn) => result; fn receives a scoped { get, all, run }
export let db = null;   // raw better-sqlite3 handle (SQLite only; null on Postgres)

// ---------------------------------------------------------------------------
// SQLite backend
// ---------------------------------------------------------------------------
function initSqlite() {
  const sdb = new Database(config.databaseFile);
  sdb.pragma('journal_mode = WAL');
  sdb.pragma('foreign_keys = ON');
  sdb.pragma('busy_timeout = 5000');

  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  sdb.exec(schema);

  // Idempotent additive migrations for databases created before a column existed.
  const addColumn = (table, ddl) => {
    try { sdb.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`); }
    catch (e) { if (!/duplicate column/i.test(String(e.message))) throw e; }
  };
  addColumn('teachers', 'activity_seen_at TEXT');
  addColumn('teachers', 'ai_seen_at TEXT');

  db = sdb;

  const handle = {
    get: async (sql, ...p) => sdb.prepare(sql).get(...p),
    all: async (sql, ...p) => sdb.prepare(sql).all(...p),
    run: async (sql, ...p) => {
      const info = sdb.prepare(sql).run(...p);
      return { lastInsertRowid: info.lastInsertRowid, changes: info.changes };
    },
  };
  q = handle;

  // better-sqlite3 is synchronous, so an awaited body between BEGIN/COMMIT runs to
  // completion within one microtask drain — no other statement can interleave.
  tx = async (fn) => {
    sdb.exec('BEGIN');
    try {
      const r = await fn(handle);
      sdb.exec('COMMIT');
      return r;
    } catch (e) {
      try { sdb.exec('ROLLBACK'); } catch { /* ignore */ }
      throw e;
    }
  };
}

// ---------------------------------------------------------------------------
// Postgres backend (Supabase)
// ---------------------------------------------------------------------------
// Tables whose primary key is `token`, not `id` — appending RETURNING id would error.
const ID_LESS_TABLES = new Set(['teacher_sessions', 'student_sessions']);

function toPg(sql) {
  // Strip SQLite-only INSERT modifier; remember whether to add ON CONFLICT DO NOTHING.
  const wasIgnore = /INSERT\s+OR\s+IGNORE/i.test(sql);
  let s = sql.replace(/INSERT\s+OR\s+IGNORE\s+INTO/gi, 'INSERT INTO');
  // Positional params: ? → $1, $2, … (these SQL strings never contain a literal ?).
  let n = 0;
  s = s.replace(/\?/g, () => `$${++n}`);
  return { s, wasIgnore };
}

function insertTable(sql) {
  const m = /^\s*INSERT\s+(?:OR\s+\w+\s+)?INTO\s+([A-Za-z_][A-Za-z0-9_]*)/i.exec(sql);
  return m ? m[1].toLowerCase() : null;
}

function pgQuery(client) {
  return {
    get: async (sql, ...p) => {
      const { s } = toPg(sql);
      const res = await client.query(s, p);
      return res.rows[0];
    },
    all: async (sql, ...p) => {
      const { s } = toPg(sql);
      const res = await client.query(s, p);
      return res.rows;
    },
    run: async (sql, ...p) => {
      let { s, wasIgnore } = toPg(sql);
      const table = insertTable(sql);
      if (wasIgnore && !/ON\s+CONFLICT/i.test(s)) s += ' ON CONFLICT DO NOTHING';
      let returningId = false;
      if (table && !ID_LESS_TABLES.has(table) && !/RETURNING/i.test(s)) {
        s += ' RETURNING id';
        returningId = true;
      }
      const res = await client.query(s, p);
      const row = returningId && res.rows[0] ? res.rows[0] : undefined;
      return {
        lastInsertRowid: row ? row.id : undefined,
        changes: res.rowCount,
      };
    },
  };
}

// Accept connection strings with or without the scheme (a bare `//host` or
// `host:port/db` otherwise makes pg fall back to a unix socket).
function normalizePgUrl(url) {
  const s = String(url).trim();
  if (/^postgres(ql)?:\/\//i.test(s)) return s;
  if (s.startsWith('//')) return 'postgresql:' + s;
  return 'postgresql://' + s;
}

async function initPg() {
  const { default: pg } = await import('pg');

  // Keep Postgres results shaped like SQLite for the app + frontend.
  pg.types.setTypeParser(1184, (v) => (v == null ? null : new Date(v).toISOString())); // timestamptz
  pg.types.setTypeParser(1114, (v) => (v == null ? null : new Date(v + 'Z').toISOString())); // timestamp
  pg.types.setTypeParser(20, (v) => (v == null ? null : Number(v)));   // int8 (COUNT etc.)
  pg.types.setTypeParser(1700, (v) => (v == null ? null : Number(v))); // numeric

  const connectionString = normalizePgUrl(config.databaseUrl);
  const needsSsl = !/localhost|127\.0\.0\.1/.test(connectionString);
  const pool = new pg.Pool({
    connectionString,
    max: 10,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
  });
  await pool.query('SELECT 1'); // fail fast on bad credentials

  q = pgQuery(pool);
  tx = async (fn) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const r = await fn(pgQuery(client));
      await client.query('COMMIT');
      return r;
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      throw e;
    } finally {
      client.release();
    }
  };
}

// ---------------------------------------------------------------------------
// Boot — must be awaited before serving requests or seeding.
// ---------------------------------------------------------------------------
let _ready = null;
export function initDb() {
  if (!_ready) _ready = USE_PG ? initPg() : Promise.resolve(initSqlite());
  return _ready;
}
