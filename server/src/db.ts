import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export type DB = Database.Database;

// Append-only: each entry runs once, in order, tracked by PRAGMA user_version.
const MIGRATIONS: string[] = [
  `
  CREATE TABLE watches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    origin TEXT NOT NULL,
    destination TEXT NOT NULL,
    depart_date TEXT NOT NULL,
    return_date TEXT,
    adults INTEGER NOT NULL DEFAULT 1,
    cabin TEXT NOT NULL DEFAULT 'economy',
    currency TEXT NOT NULL DEFAULT 'USD',
    max_stops INTEGER,
    target_price REAL,
    active INTEGER NOT NULL DEFAULT 1,
    check_interval_hours REAL NOT NULL,
    created_at TEXT NOT NULL,
    last_checked_at TEXT,
    next_check_at TEXT,
    last_error TEXT,
    latest_json TEXT
  );

  CREATE TABLE snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    watch_id INTEGER NOT NULL REFERENCES watches(id) ON DELETE CASCADE,
    checked_at TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('check', 'history')),
    min_price REAL,
    offer_count INTEGER NOT NULL DEFAULT 0,
    level TEXT,
    typical_low REAL,
    typical_high REAL
  );
  CREATE INDEX idx_snapshots_watch_time ON snapshots(watch_id, checked_at);

  CREATE TABLE snapshot_airlines (
    snapshot_id INTEGER NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
    airline_code TEXT NOT NULL,
    airline_name TEXT NOT NULL,
    airline_logo TEXT,
    min_price REAL NOT NULL,
    PRIMARY KEY (snapshot_id, airline_code)
  );

  CREATE TABLE alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    watch_id INTEGER NOT NULL REFERENCES watches(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    price REAL NOT NULL,
    previous_price REAL,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL,
    read_at TEXT
  );
  CREATE INDEX idx_alerts_created ON alerts(created_at);

  CREATE TABLE search_cache (
    key TEXT PRIMARY KEY,
    fetched_at TEXT NOT NULL,
    result_json TEXT NOT NULL
  );

  CREATE TABLE provider_usage (
    provider TEXT NOT NULL,
    month TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (provider, month)
  );
  `,
  // Flexible-date tracking: a watch can cover every departure date in a rolling
  // window, and each of its checks stores one price per date. For such a watch
  // depart_date is '' (it has no single date).
  `
  ALTER TABLE watches ADD COLUMN kind TEXT NOT NULL DEFAULT 'fixed';
  ALTER TABLE watches ADD COLUMN trip_days INTEGER;
  ALTER TABLE watches ADD COLUMN window_days INTEGER;

  CREATE TABLE calendar_prices (
    snapshot_id INTEGER NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
    depart_date TEXT NOT NULL,
    return_date TEXT,
    price REAL NOT NULL,
    PRIMARY KEY (snapshot_id, depart_date)
  ) WITHOUT ROWID;

  -- The dates an alert is about, for alerts raised by a flexible watch.
  ALTER TABLE alerts ADD COLUMN depart_date TEXT;
  ALTER TABLE alerts ADD COLUMN return_date TEXT;
  `,
];

export function openDatabase(file: string): DB {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const current = db.pragma('user_version', { simple: true }) as number;
  for (let version = current; version < MIGRATIONS.length; version++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[version] as string);
      db.pragma(`user_version = ${version + 1}`);
    })();
  }
  return db;
}
