import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import path from 'path';
import express from 'express';
import session from 'express-session';

const testDbDir = process.env.DB_DIR;

const { default: db } = await import('../src/db.js');
import quizRouter from '../src/api/quiz.js';
import request from 'supertest';

function createTestApp(userId = 1) {
  const app = express();
  app.use(express.json());
  app.use(session({
    secret: 'test-secret',
    resave: false,
    saveUninitialized: false,
    store: new session.MemoryStore(),
  }));
  app.use((req, res, next) => {
    req.session.userId = userId;
    req.session.username = 'testuser';
    req.session.role = 'user';
    next();
  });
  app.use('/api/quiz', quizRouter);
  return app;
}

const testApp = createTestApp(1);

function addWord(english, chinese, date) {
  return db.prepare('INSERT INTO words (english, chinese, created_at, user_id) VALUES (?, ?, ?, ?)')
    .run(english, chinese, date || '2026-05-09', 1);
}

function addRecord(wordId, correct, date) {
  return db.prepare('INSERT INTO quiz_records (word_id, correct, quiz_date, user_id) VALUES (?, ?, ?, ?)')
    .run(wordId, correct, date || '2026-05-09', 1);
}

describe('Quiz API', () => {
  beforeAll(() => {
    db.exec(`INSERT OR IGNORE INTO users (id, username, password_hash, role) VALUES (1, 'testuser', 'dummy', 'user')`);
  });

  beforeEach(() => {
    db.exec('DELETE FROM quiz_records');
    db.exec('DELETE FROM words');
    db.exec("DELETE FROM sqlite_sequence WHERE name IN ('words', 'quiz_records')");
  });

  describe('GET /api/quiz/today', () => {
    it('should return empty list when no words', async () => {
      const res = await request(testApp).get('/api/quiz/today');
      expect(res.status).toBe(200);
      expect(res.body.words).toEqual([]);
    });

    it('should always include new words added today', async () => {
      const today = new Date().toISOString().slice(0, 10);
      addWord('new1', '新词1', today);
      addWord('new2', '新词2', today);
      addWord('old1', '旧词1', '2026-01-01');
      addWord('old2', '旧词2', '2026-01-01');
      addWord('old3', '旧词3', '2026-01-01');

      const res = await request(testApp).get('/api/quiz/today');
      expect(res.status).toBe(200);
      const englishList = res.body.words.map(w => w.english);
      expect(englishList).toContain('new1');
      expect(englishList).toContain('new2');
    });

    it('should select approximately 15% of old words', async () => {
      const today = new Date().toISOString().slice(0, 10);
      addWord('new1', '新词1', today);
      // Add 20 old words — 15% = 3
      for (let i = 1; i <= 20; i++) {
        addWord(`old${i}`, `旧词${i}`, '2026-01-01');
      }

      const res = await request(testApp).get('/api/quiz/today');
      expect(res.status).toBe(200);
      // Should have 1 new + 3 old = 4 (ceil(20 * 0.15) = 3)
      expect(res.body.words.length).toBe(4);
      const englishList = res.body.words.map(w => w.english);
      expect(englishList).toContain('new1');
    });

    it('should shuffle the result', async () => {
      const today = new Date().toISOString().slice(0, 10);
      for (let i = 1; i <= 10; i++) {
        addWord(`word${i}`, `词${i}`, today);
      }

      // Run multiple times and check order varies
      const results = new Set();
      for (let i = 0; i < 5; i++) {
        const res = await request(testApp).get('/api/quiz/today');
        const order = res.body.words.map(w => w.english).join(',');
        results.add(order);
      }
      // With 10 items, shuffling should produce different orders
      expect(results.size).toBeGreaterThan(1);
    });
  });

  describe('POST /api/quiz/record', () => {
    it('should record a correct answer', async () => {
      const word = addWord('apple', '苹果');
      const res = await request(testApp)
        .post('/api/quiz/record')
        .send({ word_id: word.lastInsertRowid, correct: 1 });

      expect(res.status).toBe(201);
      const record = db.prepare('SELECT * FROM quiz_records WHERE word_id = ?').get(word.lastInsertRowid);
      expect(record.correct).toBe(1);
    });

    it('should record an incorrect answer', async () => {
      const word = addWord('apple', '苹果');
      const res = await request(testApp)
        .post('/api/quiz/record')
        .send({ word_id: word.lastInsertRowid, correct: 0 });

      expect(res.status).toBe(201);
      const record = db.prepare('SELECT * FROM quiz_records WHERE word_id = ?').get(word.lastInsertRowid);
      expect(record.correct).toBe(0);
    });

    it('should return 400 for missing fields', async () => {
      const res = await request(testApp).post('/api/quiz/record').send({ word_id: 1 });
      expect(res.status).toBe(400);
    });
  });
});
