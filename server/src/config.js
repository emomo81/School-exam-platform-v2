import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..', '..');
export const SERVER_ROOT = path.resolve(__dirname, '..');

// Minimal .env loader (no dependency). Lines: KEY=value, '#' comments.
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

export const config = {
  port: Number(process.env.PORT || 4000),
  sessionSecret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  databaseFile: process.env.DATABASE_FILE || path.join(SERVER_ROOT, 'data', 'exampro.db'),
  uploadsDir: path.join(SERVER_ROOT, 'data', 'uploads'),
  webDist: path.join(ROOT, 'web', 'dist'),
};

fs.mkdirSync(path.dirname(config.databaseFile), { recursive: true });
fs.mkdirSync(config.uploadsDir, { recursive: true });
