import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const dbDir = process.env.DB_DIR || path.join(process.cwd(), 'data');
const dbPath = path.join(dbDir, 'words.db');

fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(dbPath);

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Schema migration
db.exec(`
  CREATE TABLE IF NOT EXISTS words (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    english TEXT NOT NULL UNIQUE,
    chinese TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (date('now'))
  );

  CREATE TABLE IF NOT EXISTS quiz_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    word_id INTEGER NOT NULL REFERENCES words(id),
    correct INTEGER NOT NULL CHECK(correct IN (0, 1)),
    quiz_date TEXT NOT NULL DEFAULT (date('now'))
  );
`);

export default db;
