import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const db = new Database(config.databaseFile);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

export const q = {
  get: (sql, ...p) => db.prepare(sql).get(...p),
  all: (sql, ...p) => db.prepare(sql).all(...p),
  run: (sql, ...p) => db.prepare(sql).run(...p),
};

// Idempotent additive migrations for databases created before a column existed.
const addColumn = (table, ddl) => {
  try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`); }
  catch (e) { if (!/duplicate column/i.test(String(e.message))) throw e; }
};
addColumn('teachers', 'activity_seen_at TEXT');
addColumn('teachers', 'ai_seen_at TEXT');

export const nowIso = () => new Date().toISOString();
