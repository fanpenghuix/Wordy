import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import path from 'path';
import express from 'express';
import session from 'express-session';

const testDbDir = process.env.DB_DIR;

const { default: db } = await import('../src/db.js');
import statsRouter from '../src/api/stats.js';
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
  app.use('/api/stats', statsRouter);
  return app;
}

const testApp = createTestApp(1);

function addWord(english, chinese, date) {
  return db.prepare('INSERT INTO words (english, chinese, created_at, user_id) VALUES (?, ?, ?, ?)')
    .run(english, chinese, date || '2026-05-01', 1);
}

function addRecord(wordId, correct, date) {
  return db.prepare('INSERT INTO quiz_records (word_id, correct, quiz_date, user_id) VALUES (?, ?, ?, ?)')
    .run(wordId, correct, date || '2026-05-01', 1);
}

describe('Stats API', () => {
  beforeAll(() => {
    db.exec(`INSERT OR IGNORE INTO users (id, username, password_hash, role) VALUES (1, 'testuser', 'dummy', 'user')`);
  });

  beforeEach(() => {
    db.exec('DELETE FROM quiz_records');
    db.exec('DELETE FROM words');
    db.exec("DELETE FROM sqlite_sequence WHERE name IN ('words', 'quiz_records')");
  });

  describe('GET /api/stats/word/:id', () => {
    it('should return per-word accuracy', async () => {
      const word = addWord('apple', '苹果');
      addRecord(word.lastInsertRowid, 1, '2026-05-01');
      addRecord(word.lastInsertRowid, 1, '2026-05-02');
      addRecord(word.lastInsertRowid, 0, '2026-05-03');

      const res = await request(testApp).get(`/api/stats/word/${word.lastInsertRowid}`);
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(3);
      expect(res.body.correct).toBe(2);
      expect(res.body.accuracy).toBeCloseTo(0.667, 2);
    });

    it('should return zeros for word with no records', async () => {
      const word = addWord('new', '新的');
      const res = await request(testApp).get(`/api/stats/word/${word.lastInsertRowid}`);
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(0);
      expect(res.body.accuracy).toBe(0);
    });
  });

  describe('GET /api/stats/daily', () => {
    it('should return daily report', async () => {
      const w1 = addWord('apple', '苹果');
      const w2 = addWord('banana', '香蕉');
      addRecord(w1.lastInsertRowid, 1, '2026-05-01');
      addRecord(w2.lastInsertRowid, 0, '2026-05-01');
      addRecord(w1.lastInsertRowid, 1, '2026-05-02');

      const res = await request(testApp).get('/api/stats/daily');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);

      const may01 = res.body.find(d => d.date === '2026-05-01');
      expect(may01.total).toBe(2);
      expect(may01.correct).toBe(1);
      expect(may01.accuracy).toBe(0.5);
    });
  });

  describe('GET /api/stats/trend', () => {
    it('should return weekly trend', async () => {
      const w = addWord('apple', '苹果');
      addRecord(w.lastInsertRowid, 1, '2026-04-28');
      addRecord(w.lastInsertRowid, 0, '2026-04-29');
      addRecord(w.lastInsertRowid, 1, '2026-05-01');
      addRecord(w.lastInsertRowid, 1, '2026-05-05');

      const res = await request(testApp).get('/api/stats/trend?period=week');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      // Each item should have week label and accuracy
      expect(res.body[0]).toHaveProperty('label');
      expect(res.body[0]).toHaveProperty('accuracy');
    });
  });

  describe('GET /api/stats/worst', () => {
    it('should return worst words sorted by accuracy', async () => {
      const w1 = addWord('perfect', '完美');
      const w2 = addWord('hard', '困难');
      const w3 = addWord('medium', '中等');
      addRecord(w1.lastInsertRowid, 1, '2026-05-01');
      addRecord(w1.lastInsertRowid, 1, '2026-05-02');
      addRecord(w2.lastInsertRowid, 0, '2026-05-01');
      addRecord(w2.lastInsertRowid, 0, '2026-05-02');
      addRecord(w3.lastInsertRowid, 1, '2026-05-01');
      addRecord(w3.lastInsertRowid, 0, '2026-05-02');

      const res = await request(testApp).get('/api/stats/worst?limit=3');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(3);
      expect(res.body[0].english).toBe('hard'); // 0% accuracy
      expect(res.body[1].english).toBe('medium'); // 50% accuracy
      expect(res.body[2].english).toBe('perfect'); // 100% accuracy
    });

    it('should default limit to 10', async () => {
      for (let i = 0; i < 15; i++) {
        const w = addWord(`word${i}`, `词${i}`);
        addRecord(w.lastInsertRowid, 0, '2026-05-01');
      }

      const res = await request(testApp).get('/api/stats/worst');
      expect(res.status).toBe(200);
      expect(res.body.length).toBeLessThanOrEqual(10);
    });
  });
});
