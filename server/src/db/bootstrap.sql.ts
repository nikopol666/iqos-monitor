/**
 * Idempotent schema bootstrap, versioned with PRAGMA user_version. Kept as
 * plain SQL (mirrors schema.ts) so the standalone Docker image needs no
 * migration folder or drizzle-kit at runtime. Append new versions at the end;
 * never edit an applied one.
 */
export const MIGRATIONS: string[] = [
  // v1 – initial schema
  `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#2563eb',
    created_at_utc TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS devices (
    serial TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    model TEXT,
    firmware_raw TEXT,
    first_seen_utc TEXT NOT NULL,
    last_seen_utc TEXT,
    acked_next_index INTEGER,
    lowest_stored_index INTEGER,
    full_history_complete INTEGER NOT NULL DEFAULT 0,
    clock_warning INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS events (
    serial TEXT NOT NULL,
    event_id INTEGER NOT NULL,
    timestamp_utc TEXT,
    status TEXT NOT NULL,
    response_hex TEXT,
    raw_packets_json TEXT,
    puff_count INTEGER,
    puff_pairs_json TEXT,
    record_marker INTEGER,
    clock_suspect INTEGER NOT NULL DEFAULT 0,
    fetched_at_utc TEXT NOT NULL,
    received_at_utc TEXT NOT NULL,
    PRIMARY KEY (serial, event_id)
  );
  CREATE INDEX IF NOT EXISTS events_time ON events(serial, timestamp_utc);
  CREATE TABLE IF NOT EXISTS snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    serial TEXT NOT NULL,
    collected_utc TEXT NOT NULL,
    values_json TEXT NOT NULL,
    statuses_json TEXT NOT NULL,
    frames_json TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS snapshots_latest ON snapshots(serial, id);
  CREATE TABLE IF NOT EXISTS live_state (
    serial TEXT PRIMARY KEY,
    agent_id INTEGER,
    updated_utc TEXT NOT NULL,
    battery INTEGER,
    stick_state TEXT,
    error_state INTEGER,
    lifetime_sticks INTEGER,
    lifetime_puffs INTEGER,
    lifetime_seconds INTEGER,
    session_raw TEXT,
    disconnected_utc TEXT,
    sync_status TEXT
  );
  CREATE TABLE IF NOT EXISTS live_samples (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    serial TEXT NOT NULL,
    at_utc TEXT NOT NULL,
    battery INTEGER,
    stick_state TEXT,
    lifetime_sticks INTEGER,
    lifetime_puffs INTEGER
  );
  CREATE INDEX IF NOT EXISTS live_samples_time ON live_samples(serial, at_utc);
  CREATE TABLE IF NOT EXISTS observations (
    serial TEXT NOT NULL,
    event_id INTEGER NOT NULL,
    end_notice_utc TEXT,
    puffs_estimate INTEGER,
    source TEXT NOT NULL,
    PRIMARY KEY (serial, event_id)
  );
  CREATE TABLE IF NOT EXISTS agents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    api_key_hash TEXT NOT NULL UNIQUE,
    key_prefix TEXT NOT NULL,
    created_at_utc TEXT NOT NULL,
    last_seen_utc TEXT,
    version TEXT,
    hostname TEXT
  );
  CREATE TABLE IF NOT EXISTS agent_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    serial TEXT NOT NULL,
    type TEXT NOT NULL,
    payload_json TEXT,
    status TEXT NOT NULL DEFAULT 'queued',
    progress_done INTEGER NOT NULL DEFAULT 0,
    progress_total INTEGER,
    message TEXT,
    created_utc TEXT NOT NULL,
    updated_utc TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS agent_jobs_serial ON agent_jobs(serial, status);
  `,
  // v2 – per-device colour and image variant
  `
  ALTER TABLE devices ADD COLUMN color TEXT NOT NULL DEFAULT '#2a78d6';
  ALTER TABLE devices ADD COLUMN variant TEXT NOT NULL DEFAULT 'iluma-i-one-breeze-blue';
  UPDATE devices SET color = CASE ((SELECT count(*) FROM devices d2 WHERE d2.rowid < devices.rowid) % 8)
    WHEN 0 THEN '#2a78d6' WHEN 1 THEN '#eb6834' WHEN 2 THEN '#1baf7a' WHEN 3 THEN '#eda100'
    WHEN 4 THEN '#e87ba4' WHEN 5 THEN '#008300' WHEN 6 THEN '#6250d6' ELSE '#e34948' END;
  `,
  // v3 – palette keys instead of hex, colour follows the finish unless customised
  `
  ALTER TABLE devices ADD COLUMN color_custom INTEGER NOT NULL DEFAULT 0;
  UPDATE devices SET color = CASE lower(color)
    WHEN '#2a78d6' THEN 'blue' WHEN '#3987e5' THEN 'blue'
    WHEN '#eb6834' THEN 'orange' WHEN '#d95926' THEN 'orange'
    WHEN '#1baf7a' THEN 'aqua' WHEN '#199e70' THEN 'aqua'
    WHEN '#eda100' THEN 'yellow' WHEN '#c98500' THEN 'yellow'
    WHEN '#e87ba4' THEN 'magenta' WHEN '#d55181' THEN 'magenta'
    WHEN '#008300' THEN 'green'
    WHEN '#6250d6' THEN 'violet' WHEN '#9085e9' THEN 'violet'
    WHEN '#e34948' THEN 'red' WHEN '#e66767' THEN 'red'
    ELSE color END;
  `,
];
