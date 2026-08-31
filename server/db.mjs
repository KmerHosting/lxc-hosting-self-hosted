import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export function openDatabase(filename) {
  fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const db = new Database(filename);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin','member')), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS containers (
      id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL UNIQUE, image TEXT NOT NULL, cpu INTEGER NOT NULL, memory_mb INTEGER NOT NULL,
      storage_gb INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS audit_events (
      id INTEGER PRIMARY KEY, actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL, target TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}

export function configured(db) { return Boolean(db.prepare("SELECT 1 FROM users WHERE role = 'admin'").get()); }
export function setting(db, key, fallback = null) { return db.prepare("SELECT value FROM settings WHERE key = ?").get(key)?.value ?? fallback; }
export function setSetting(db, key, value) { db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, String(value)); }
export function audit(db, actorId, action, target) { db.prepare("INSERT INTO audit_events(actor_id,action,target) VALUES(?,?,?)").run(actorId ?? null, action, target); }
