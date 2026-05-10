import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcrypt';

const dbDir = process.env.DB_DIR || path.join(process.cwd(), 'data');
const dbPath = path.join(dbDir, 'words.db');

fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(dbPath);

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Create users table
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin', 'user')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Check if words table exists and whether migration is needed
const wordsColumns = db.pragma('table_info(words)');

if (wordsColumns.length === 0) {
  // Fresh database: create tables with user_id from the start
  db.exec(`
    CREATE TABLE words (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id),
      english TEXT NOT NULL,
      chinese TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (date('now'))
    );

    CREATE TABLE IF NOT EXISTS quiz_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id),
      word_id INTEGER NOT NULL REFERENCES words(id),
      correct INTEGER NOT NULL CHECK(correct IN (0, 1)),
      quiz_date TEXT NOT NULL DEFAULT (date('now'))
    );
  `);
} else {
  // Existing database: add user_id if missing
  const hasUserId = wordsColumns.some(c => c.name === 'user_id');
  if (!hasUserId) {
    db.exec('ALTER TABLE words ADD COLUMN user_id INTEGER REFERENCES users(id)');
  }

  const quizColumns = db.pragma('table_info(quiz_records)').map(c => c.name);
  if (!quizColumns.includes('user_id')) {
    db.exec('ALTER TABLE quiz_records ADD COLUMN user_id INTEGER REFERENCES users(id)');
  }
}

// Migration: create default admin user and migrate existing data
const adminExists = db.prepare('SELECT COUNT(*) as count FROM users').get().count > 0;
if (!adminExists) {
  const hash = bcrypt.hashSync('Admin@123456.', 10);
  db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run('admin', hash, 'admin');
}

// Migrate NULL user_id data to admin
const admin = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
if (admin) {
  db.prepare('UPDATE words SET user_id = ? WHERE user_id IS NULL').run(admin.id);
  db.prepare('UPDATE quiz_records SET user_id = ? WHERE user_id IS NULL').run(admin.id);
}

// Per-user uniqueness of english words (idempotent)
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_words_user_english ON words(user_id, english)`);

// SM-2 spaced repetition reviews
db.exec(`
  CREATE TABLE IF NOT EXISTS sm2_reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    word_id INTEGER NOT NULL REFERENCES words(id),
    interval INTEGER NOT NULL DEFAULT 0,
    efactor REAL NOT NULL DEFAULT 2.5,
    repetitions INTEGER NOT NULL DEFAULT 0,
    next_review TEXT NOT NULL,
    last_review TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, word_id)
  );
`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_sm2_reviews_next_review ON sm2_reviews(next_review)`);

export default db;
