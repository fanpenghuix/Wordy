import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import path from 'path';
import express from 'express';
import session from 'express-session';

const testDbDir = process.env.DB_DIR;

const { default: db } = await import('../src/db.js');
import quizRouter from '../src/api/quiz.js';
import request from 'supertest';

// Use a dedicated test user that won't conflict with other test files
const TEST_USER_ID = 9999;

function createTestApp(userId = TEST_USER_ID) {
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

const testApp = createTestApp(TEST_USER_ID);

function addWord(english, chinese, date) {
  return db.prepare('INSERT INTO words (english, chinese, created_at, user_id) VALUES (?, ?, ?, ?)')
    .run(english, chinese, date || '2026-05-09', TEST_USER_ID);
}

function initSm2Review(wordId, nextReview) {
  db.prepare(`
    INSERT INTO sm2_reviews (user_id, word_id, interval, efactor, repetitions, next_review)
    VALUES (${TEST_USER_ID}, ?, 0, 2.5, 0, ?)
  `).run(wordId, nextReview || '2026-01-01');
}

function setSm2Due(wordId, interval, repetitions) {
  const today = new Date().toISOString().slice(0, 10);
  db.prepare('UPDATE sm2_reviews SET interval = ?, repetitions = ?, next_review = ? WHERE word_id = ?')
    .run(interval, repetitions, today, wordId);
}

describe('Quiz API (SM-2)', () => {
  beforeAll(() => {
    db.prepare(`INSERT OR IGNORE INTO users (id, username, password_hash, role) VALUES (?, 'testuser', 'dummy', 'user')`).run(TEST_USER_ID);
  });

  beforeEach(() => {
    db.exec('DELETE FROM quiz_session');
    db.exec('DELETE FROM quiz_records');
    db.exec(`DELETE FROM sm2_reviews WHERE user_id = ${TEST_USER_ID}`);
    db.exec(`DELETE FROM words WHERE user_id = ${TEST_USER_ID}`);
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
      const future = new Date(Date.now() + 86400000 * 5).toISOString().slice(0, 10);
      // Add words with future reviews (not due) so dailyLimit (20% of 10 = 2) is > dueWords count
      for (let i = 1; i <= 8; i++) {
        const w = addWord(`filled${i}`, `填充${i}`, '2026-01-01');
        initSm2Review(w.lastInsertRowid, future);
      }
      // New words (no sm2_reviews) — should be included in remaining slots
      addWord('new1', '新词1', today);
      addWord('new2', '新词2', today);

      const res = await request(testApp).get('/api/quiz/today');
      expect(res.status).toBe(200);
      const englishList = res.body.words.map(w => w.english);
      expect(englishList).toContain('new1');
      expect(englishList).toContain('new2');
    });

    it('should include due words from sm2_reviews', async () => {
      // Add enough words so dailyLimit (20%) covers both due words
      const today = new Date().toISOString().slice(0, 10);
      const future = new Date(Date.now() + 86400000 * 3).toISOString().slice(0, 10);

      // Due words (next_review = today)
      const w1 = addWord('due1', '到期1', '2026-01-01');
      const w2 = addWord('due2', '到期2', '2026-01-01');
      initSm2Review(w1.lastInsertRowid, today);
      setSm2Due(w1.lastInsertRowid, 1, 1);
      initSm2Review(w2.lastInsertRowid, today);
      setSm2Due(w2.lastInsertRowid, 1, 1);

      // Non-due words (future review dates) to pad dailyLimit
      for (let i = 3; i <= 10; i++) {
        const w = addWord(`due${i}`, `到期${i}`, '2026-01-01');
        initSm2Review(w.lastInsertRowid, future);
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

      // Add due words to fill the dailyLimit (10 words * 20% = 2)
      for (let i = 1; i <= 5; i++) {
        const w = addWord(`due${i}`, `到期${i}`, '2026-01-01');
        initSm2Review(w.lastInsertRowid, today);
        setSm2Due(w.lastInsertRowid, 1, 1);
      }

      // Non-due word (should not appear)
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

    it('extra fill should vary words across sessions (weighted random)', async () => {
      // Create 50 words, all with sm2_reviews, none due today
      // dailyLimit = ceil(50 * 0.20) = 10 words (default 20% ratio, no preferences set)
      const future = new Date(Date.now() + 86400000 * 3).toISOString().slice(0, 10);
      for (let i = 0; i < 50; i++) {
        const w = addWord(`rand${i}`, `随机${i}`, '2026-01-01');
        db.prepare(`
          INSERT INTO sm2_reviews (user_id, word_id, interval, efactor, repetitions, next_review)
          VALUES (${TEST_USER_ID}, ?, 3, 2.5, 2, ?)
        `).run(w.lastInsertRowid, future);
      }

      // Fetch today's quiz multiple times, collect unique words seen
      const allWords = new Set();
      for (let i = 0; i < 5; i++) {
        const res = await request(testApp).get('/api/quiz/today');
        expect(res.status).toBe(200);
        res.body.words.forEach(w => allWords.add(w.english));
        // Clear session so next call generates new words
        db.exec("DELETE FROM quiz_session");
      }

      // With weighted random, across 5 sessions of 10 words each (50 total picks),
      // we should see significantly more than 10 unique words out of 50
      // With pure ASC ordering, we'd only see the same 10 words every time
      expect(allWords.size).toBeGreaterThan(15);
    });
  });

  describe('POST /api/quiz/record', () => {
    it('should record a correct answer with quizMode', async () => {
      const word = addWord('apple', '苹果');
      const res = await request(testApp)
        .post('/api/quiz/record')
        .send({ word_id: word.lastInsertRowid, correct: 1, quizMode: 'spelling' });

      expect(res.status).toBe(201);
      const record = db.prepare('SELECT * FROM quiz_records WHERE word_id = ?').get(word.lastInsertRowid);
      expect(record.correct).toBe(1);
      expect(record.quiz_mode).toBe('spelling');
    });

    it('should record an incorrect answer with quizMode', async () => {
      const word = addWord('apple', '苹果');
      const res = await request(testApp)
        .post('/api/quiz/record')
        .send({ word_id: word.lastInsertRowid, correct: 0, quizMode: 'reading' });

      expect(res.status).toBe(201);
      const record = db.prepare('SELECT * FROM quiz_records WHERE word_id = ?').get(word.lastInsertRowid);
      expect(record.correct).toBe(0);
      expect(record.quiz_mode).toBe('reading');
    });

    it('should accept listening quizMode', async () => {
      const word = addWord('test', '测试');
      const res = await request(testApp)
        .post('/api/quiz/record')
        .send({ word_id: word.lastInsertRowid, correct: 1, quizMode: 'listening' });

      expect(res.status).toBe(201);
      const record = db.prepare('SELECT * FROM quiz_records WHERE word_id = ?').get(word.lastInsertRowid);
      expect(record.quiz_mode).toBe('listening');
    });

    it('should reject invalid quizMode', async () => {
      const word = addWord('test', '测试');
      const res = await request(testApp)
        .post('/api/quiz/record')
        .send({ word_id: word.lastInsertRowid, correct: 1, quizMode: 'invalid' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid quizMode');
    });

    it('should update SM-2 state on correct answer', async () => {
      const word = addWord('test', '测试');
      initSm2Review(word.lastInsertRowid);

      await request(testApp)
        .post('/api/quiz/record')
        .send({ word_id: word.lastInsertRowid, correct: 1, quizMode: 'spelling' });

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
