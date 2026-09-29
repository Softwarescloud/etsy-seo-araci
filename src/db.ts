import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config.ts';

mkdirSync(dirname(config.dbPath), { recursive: true });

export const db = new DatabaseSync(config.dbPath);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS keywords (
  keyword       TEXT PRIMARY KEY,
  first_seen_at TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS searches (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword       TEXT NOT NULL,
  results_total INTEGER NOT NULL,
  listing_count INTEGER NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_searches_kw ON searches(keyword, created_at DESC);

CREATE TABLE IF NOT EXISTS keyword_daily (
  keyword       TEXT NOT NULL,
  day           TEXT NOT NULL,
  samples       INTEGER NOT NULL DEFAULT 0,
  title_hits    INTEGER NOT NULL DEFAULT 0,
  tag_hits      INTEGER NOT NULL DEFAULT 0,
  top3_hits     INTEGER NOT NULL DEFAULT 0,
  top10_hits    INTEGER NOT NULL DEFAULT 0,
  position_sum  REAL    NOT NULL DEFAULT 0,
  results_total INTEGER,
  updated_at    TEXT NOT NULL,
  PRIMARY KEY (keyword, day)
);
CREATE INDEX IF NOT EXISTS idx_kwdaily_day ON keyword_daily(day);

CREATE TABLE IF NOT EXISTS listing_cache (
  cache_key    TEXT PRIMARY KEY,
  payload      TEXT NOT NULL,
  expires_at   INTEGER NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_listing_cache_exp ON listing_cache(expires_at);

CREATE TABLE IF NOT EXISTS saved_keywords (
  keyword    TEXT PRIMARY KEY,
  note       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS automation_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  task        TEXT NOT NULL,
  status      TEXT NOT NULL,
  message     TEXT NOT NULL DEFAULT '',
  started_at  TEXT NOT NULL,
  finished_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_runs_task ON automation_runs(task, started_at DESC);

CREATE TABLE IF NOT EXISTS shop_audit_daily (
  shop_id    TEXT NOT NULL,
  listing_id INTEGER NOT NULL,
  day        TEXT NOT NULL,
  score      INTEGER NOT NULL,
  grade      TEXT NOT NULL,
  tag_count  INTEGER NOT NULL,
  title      TEXT NOT NULL,
  PRIMARY KEY (shop_id, listing_id, day)
);
CREATE INDEX IF NOT EXISTS idx_shop_daily_day ON shop_audit_daily(shop_id, day DESC);
`);

export function nowIso(): string {
  return new Date().toISOString();
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function upsertKeyword(keyword: string): void {
  const ts = nowIso();
  db.prepare(
    `INSERT INTO keywords (keyword, first_seen_at, last_seen_at)
     VALUES (?, ?, ?)
     ON CONFLICT(keyword) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
  ).run(keyword, ts, ts);
}

export function getCached<T>(key: string, ttlMs: number): T | null {
  const row = db
    .prepare('SELECT payload, expires_at FROM listing_cache WHERE cache_key = ?')
    .get(key) as { payload: string; expires_at: number } | undefined;
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    db.prepare('DELETE FROM listing_cache WHERE cache_key = ?').run(key);
    return null;
  }
  return JSON.parse(row.payload) as T;
}

export function setCached(key: string, value: unknown, ttlMs: number): void {
  db.prepare(
    `INSERT INTO listing_cache (cache_key, payload, expires_at, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(cache_key) DO UPDATE SET
       payload = excluded.payload,
       expires_at = excluded.expires_at,
       created_at = excluded.created_at`,
  ).run(key, JSON.stringify(value), Date.now() + ttlMs, nowIso());
}

export function purgeExpiredCache(): number {
  const result = db.prepare('DELETE FROM listing_cache WHERE expires_at < ?').run(Date.now());
  return Number(result.changes);
}
