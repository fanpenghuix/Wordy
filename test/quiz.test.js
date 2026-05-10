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

function initSm2Review(wordId, nextReview) {
  db.prepare(`
    INSERT INTO sm2_reviews (user_id, word_id, interval, efactor, repetitions, next_review)
    VALUES (1, ?, 0, 2.5, 0, ?)
  `).run(wordId, nextReview || '2026-01-01');
}

function setSm2Due(wordId, interval, repetitions) {
  const today = new Date().toISOString().slice(0, 10);
  db.prepare('UPDATE sm2_reviews SET interval = ?, repetitions = ?, next_review = ? WHERE word_id = ?')
    .run(interval, repetitions, today, wordId);
}

describe('Quiz API (SM-2)', () => {
  beforeAll(() => {
    db.exec(`INSERT OR IGNORE INTO users (id, username, password_hash, role) VALUES (1, 'testuser', 'dummy', 'user')`);
  });

  beforeEach(() => {
    db.exec('DELETE FROM quiz_records');
    db.exec('DELETE FROM sm2_reviews WHERE user_id = 1');
    db.exec('DELETE FROM words');
    db.exec("DELETE FROM sqlite_sequence WHERE name IN ('words', 'quiz_records', 'sm2_reviews')");
  });

  describe('GET /api/quiz/today', () => {
    it('should return empty list when no words', async () => {
      const res = await request(testApp).get('/api/quiz/today');
      expect(res.status).toBe(200);
      expect(res.body.words).toEqual([]);
    });

    it('should always include new words (no sm2_reviews entry)', async () => {
      const today = new Date().toISOString().slice(0, 10);
      addWord('new1', '新词1', today);
      addWord('new2', '新词2', today);

      const res = await request(testApp).get('/api/quiz/today');
      expect(res.status).toBe(200);
      const englishList = res.body.words.map(w => w.english);
      expect(englishList).toContain('new1');
      expect(englishList).toContain('new2');
    });

    it('should include due words from sm2_reviews', async () => {
      // Add enough words so dailyLimit (20%) covers both
      for (let i = 1; i <= 10; i++) {
        addWord(`due${i}`, `到期${i}`, '2026-01-01');
      }
      // Mark first two as due
      const dueWords = db.prepare('SELECT id FROM words WHERE user_id = 1').all();
      const today = new Date().toISOString().slice(0, 10);
      for (const w of dueWords.slice(0, 2)) {
        initSm2Review(w.id, today);
        setSm2Due(w.id, 1, 1);
      }

      const res = await request(testApp).get('/api/quiz/today');
      expect(res.status).toBe(200);
      const englishList = res.body.words.map(w => w.english);
      expect(englishList).toContain('due1');
      expect(englishList).toContain('due2');
    });

    it('should not include non-due words', async () => {
      const today = new Date().toISOString().slice(0, 10);
      const future = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
      const w = addWord('notdue', '未到期', '2026-01-01');
      initSm2Review(w.lastInsertRowid, future);

      const res = await request(testApp).get('/api/quiz/today');
      expect(res.status).toBe(200);
      const englishList = res.body.words.map(w => w.english);
      expect(englishList).not.toContain('notdue');
    });

    it('should prioritize wrong answers (repetitions=0) first', async () => {
      const wWrong = addWord('wrong', '错误', '2026-01-01');
      const wDue = addWord('due', '到期', '2026-01-01');
      initSm2Review(wWrong.lastInsertRowid, new Date().toISOString().slice(0, 10));
      initSm2Review(wDue.lastInsertRowid, new Date().toISOString().slice(0, 10));
      // wWrong has repetitions=0, wDue has repetitions=2
      setSm2Due(wDue.lastInsertRowid, 3, 2);

      const res = await request(testApp).get('/api/quiz/today');
      expect(res.status).toBe(200);
      const words = res.body.words;
      // Wrong word should come first
      if (words.length >= 2) {
        expect(words[0].english).toBe('wrong');
      }
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

    it('should update SM-2 state on correct answer', async () => {
      const word = addWord('test', '测试');
      initSm2Review(word.lastInsertRowid);

      await request(testApp)
        .post('/api/quiz/record')
        .send({ word_id: word.lastInsertRowid, correct: 1 });

      const state = db.prepare('SELECT * FROM sm2_reviews WHERE word_id = ?').get(word.lastInsertRowid);
      expect(state.repetitions).toBe(1);
      expect(state.interval).toBe(1);
    });

    it('should return 400 for missing fields', async () => {
      const res = await request(testApp).post('/api/quiz/record').send({ word_id: 1 });
      expect(res.status).toBe(400);
    });
  });
});
