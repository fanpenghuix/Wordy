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

// Check if words table exists and has user_id
const wordsColumns = db.pragma('table_info(words)');
const hasUserId = wordsColumns.some(c => c.name === 'user_id');
const hasUniqueEnglish = wordsColumns.some(c => c.name === 'english' && c.notnull === 1);

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

    CREATE TABLE quiz_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id),
      word_id INTEGER NOT NULL REFERENCES words(id),
      correct INTEGER NOT NULL CHECK(correct IN (0, 1)),
      quiz_date TEXT NOT NULL DEFAULT (date('now'))
    );
  `);
} else {
  // Existing database: rebuild words table to remove UNIQUE on english and add user_id
  db.exec(`
    CREATE TABLE words_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id),
      english TEXT NOT NULL,
      chinese TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (date('now'))
    );
    INSERT INTO words_new (id, english, chinese, created_at) SELECT id, english, chinese, created_at FROM words;
    DROP TABLE words;
    ALTER TABLE words_new RENAME TO words;
  `);

  // Add user_id to quiz_records if not exists
  const quizColumns = db.pragma('table_info(quiz_records)').map(c => c.name);
  if (!quizColumns.includes('user_id')) {
    db.exec('ALTER TABLE quiz_records ADD COLUMN user_id INTEGER REFERENCES users(id)');
  }
}

// Migration: create default admin user and migrate existing data
const bcrypt = await import('bcrypt');
const hash = bcrypt.hashSync('Admin123456', 10);
db.prepare('INSERT OR IGNORE INTO users (username, password_hash, role) VALUES (?, ?, ?)').run('admin', hash, 'admin');

// Always migrate NULL user_id data to admin
const admin = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
if (admin) {
  db.prepare('UPDATE words SET user_id = ? WHERE user_id IS NULL').run(admin.id);
  db.prepare('UPDATE quiz_records SET user_id = ? WHERE user_id IS NULL').run(admin.id);
}

// Per-user uniqueness of english words
db.exec(`DROP INDEX IF EXISTS idx_words_user_english`);
db.exec(`CREATE UNIQUE INDEX idx_words_user_english ON words(user_id, english)`);

export default db;
