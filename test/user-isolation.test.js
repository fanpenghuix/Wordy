import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import session from 'express-session';
import request from 'supertest';

// Use same DB dir as other tests since vitest shares db module
const testDbDir = process.env.DB_DIR;

const { default: db } = await import('../src/db.js');
import wordsRouter from '../src/api/words.js';
import quizRouter from '../src/api/quiz.js';
import statsRouter from '../src/api/stats.js';
import authRouter from '../src/api/auth.js';

function createTestApp(user) {
  const app = express();
  app.use(express.json());
  app.use(session({
    secret: 'test-secret',
    resave: false,
    saveUninitialized: false,
    store: new session.MemoryStore(),
  }));
  if (user) {
    app.use((req, res, next) => {
      req.session.userId = user.id;
      req.session.username = user.username;
      req.session.role = user.role;
      next();
    });
  }
  app.use('/api/auth', authRouter);
  app.use('/api/words', wordsRouter);
  app.use('/api/quiz', quizRouter);
  app.use('/api/stats', statsRouter);
  return app;
}

async function createUser(username, role) {
  const bcrypt = await import('bcrypt');
  const hash = bcrypt.hashSync('TestPass1', 10);
  const result = db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(username, hash, role);
  return result.lastInsertRowid;
}

describe('User Data Isolation', () => {
  let appA, appB, appNoAuth;
  let userAId, userBId;

  beforeAll(async () => {
    // Clean up any leftover test data
    db.exec('DELETE FROM quiz_records');
    db.exec('DELETE FROM sm2_reviews');
    db.exec('DELETE FROM words');
    db.exec("DELETE FROM users WHERE username IN ('alice', 'bob')");
    db.exec("DELETE FROM sqlite_sequence WHERE name IN ('words', 'users', 'sm2_reviews')");

    userAId = await createUser('alice', 'user');
    userBId = await createUser('bob', 'user');
    appA = createTestApp({ id: userAId, username: 'alice', role: 'user' });
    appB = createTestApp({ id: userBId, username: 'bob', role: 'user' });
    appNoAuth = createTestApp(null);
  });

  beforeEach(() => {
    db.exec('DELETE FROM quiz_records');
    db.exec('DELETE FROM sm2_reviews');
    db.exec('DELETE FROM words');
    db.exec("DELETE FROM sqlite_sequence WHERE name='words'");
  });

  afterAll(() => {
    // Clean up isolation test users
    db.exec("DELETE FROM users WHERE username IN ('alice', 'bob')");
  });

  describe('Words isolation', () => {
    it('each user only sees their own words', async () => {
      await request(appA).post('/api/words').send({ english: 'apple', chinese: '苹果' });
      await request(appB).post('/api/words').send({ english: 'banana', chinese: '香蕉' });

      const aliceWords = await request(appA).get('/api/words');
      expect(aliceWords.body).toHaveLength(1);
      expect(aliceWords.body[0].english).toBe('apple');

      const bobWords = await request(appB).get('/api/words');
      expect(bobWords.body).toHaveLength(1);
      expect(bobWords.body[0].english).toBe('banana');
    });

    it('cannot update another users word', async () => {
      const insert = db.prepare('INSERT INTO words (english, chinese, user_id) VALUES (?, ?, ?)').run('secret', '秘密', userAId);
      const wordId = insert.lastInsertRowid;

      const res = await request(appB)
        .put(`/api/words/${wordId}`)
        .send({ english: 'hacked', chinese: '被黑' });

      expect(res.status).toBe(404);
    });

    it('cannot delete another users word', async () => {
      const insert = db.prepare('INSERT INTO words (english, chinese, user_id) VALUES (?, ?, ?)').run('keep', '保留', userAId);
      const wordId = insert.lastInsertRowid;

      const res = await request(appB).delete(`/api/words/${wordId}`);
      expect(res.status).toBe(404);

      const word = db.prepare('SELECT * FROM words WHERE id = ?').get(wordId);
      expect(word).toBeDefined();
    });

    it('duplicate english allowed across users', async () => {
      await request(appA).post('/api/words').send({ english: 'hello', chinese: '你好A' });
      const res = await request(appB).post('/api/words').send({ english: 'hello', chinese: '你好B' });
      expect(res.status).toBe(201);
    });

    it('duplicate english not allowed for same user', async () => {
      await request(appA).post('/api/words').send({ english: 'world', chinese: '世界A' });
      const res = await request(appA).post('/api/words').send({ english: 'world', chinese: '世界B' });
      expect(res.status).toBe(409);
    });
  });

  describe('Quiz isolation', () => {
    it('quiz only includes current users words', async () => {
      db.prepare('INSERT INTO words (english, chinese, user_id) VALUES (?, ?, ?)').run('alpha', '阿尔法', userAId);
      db.prepare('INSERT INTO words (english, chinese, user_id) VALUES (?, ?, ?)').run('beta', '贝塔', userBId);

      const resA = await request(appA).get('/api/quiz/today');
      expect(resA.body.words.some(w => w.english === 'alpha')).toBe(true);
      expect(resA.body.words.some(w => w.english === 'beta')).toBe(false);
    });

    it('quiz record is scoped to current user', async () => {
      const insert = db.prepare('INSERT INTO words (english, chinese, user_id) VALUES (?, ?, ?)').run('gamma', '伽马', userAId);
      const wordId = insert.lastInsertRowid;

      await request(appA).post('/api/quiz/record').send({ word_id: wordId, correct: 1 });

      const record = db.prepare('SELECT * FROM quiz_records WHERE word_id = ?').get(wordId);
      expect(record.user_id).toBe(userAId);
    });
  });

  describe('Stats isolation', () => {
    it('worst words only show current users words', async () => {
      const insertA = db.prepare('INSERT INTO words (english, chinese, user_id) VALUES (?, ?, ?)').run('wrongA', '错A', userAId);
      db.prepare('INSERT INTO quiz_records (word_id, correct, user_id) VALUES (?, ?, ?)').run(insertA.lastInsertRowid, 0, userAId);

      const insertB = db.prepare('INSERT INTO words (english, chinese, user_id) VALUES (?, ?, ?)').run('wrongB', '错B', userBId);
      db.prepare('INSERT INTO quiz_records (word_id, correct, user_id) VALUES (?, ?, ?)').run(insertB.lastInsertRowid, 0, userBId);

      const resA = await request(appA).get('/api/stats/worst');
      expect(resA.body.some(w => w.english === 'wrongA')).toBe(true);
      expect(resA.body.some(w => w.english === 'wrongB')).toBe(false);
    });
  });

  describe('Auth required', () => {
    it('returns 401 for unauthenticated word access', async () => {
      const res = await request(appNoAuth).get('/api/words');
      expect(res.status).toBe(401);
    });

    it('returns 401 for unauthenticated quiz access', async () => {
      const res = await request(appNoAuth).get('/api/quiz/today');
      expect(res.status).toBe(401);
    });
  });
});
