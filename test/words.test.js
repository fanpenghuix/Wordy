import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import path from 'path';
import express from 'express';
import session from 'express-session';

const testDbDir = process.env.DB_DIR;

const { default: db } = await import('../src/db.js');
import request from 'supertest';
import wordsRouter from '../src/api/words.js';

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
  app.use('/api/words', wordsRouter);
  return app;
}

const testApp = createTestApp(1);

describe('Words API', () => {
  beforeAll(() => {
    // Ensure test user exists
    db.exec(`INSERT OR IGNORE INTO users (id, username, password_hash, role) VALUES (1, 'testuser', 'dummy', 'user')`);
  });

  beforeEach(() => {
    db.exec('DELETE FROM quiz_records');
    db.exec('DELETE FROM words');
    db.exec("DELETE FROM sqlite_sequence WHERE name IN ('words', 'quiz_records')");
  });

  describe('POST /api/words', () => {
    it('should create a word', async () => {
      const res = await request(testApp)
        .post('/api/words')
        .send({ english: 'apple', chinese: '苹果' });

      expect(res.status).toBe(201);
      expect(res.body.english).toBe('apple');
      expect(res.body.chinese).toBe('苹果');
      expect(res.body.id).toBeDefined();
    });

    it('should return 409 for duplicate word', async () => {
      await request(testApp).post('/api/words').send({ english: 'apple', chinese: '苹果' });
      const res = await request(testApp)
        .post('/api/words')
        .send({ english: 'apple', chinese: '苹果' });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('该单词已存在');
    });

    it('should return 400 for missing fields', async () => {
      const res = await request(testApp).post('/api/words').send({ english: 'apple' });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/words', () => {
    it('should return all words', async () => {
      db.prepare("INSERT INTO words (english, chinese, created_at, user_id) VALUES (?, ?, ?, ?)").run('cat', '猫', '2026-05-09', 1);
      db.prepare("INSERT INTO words (english, chinese, created_at, user_id) VALUES (?, ?, ?, ?)").run('dog', '狗', '2026-05-09', 1);

      const res = await request(testApp).get('/api/words');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
    });

    it('should return empty array when no words', async () => {
      const res = await request(testApp).get('/api/words');
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  describe('PUT /api/words/:id', () => {
    it('should update a word', async () => {
      const insert = db.prepare("INSERT INTO words (english, chinese, created_at, user_id) VALUES (?, ?, ?, ?)").run('cat', '猫', '2026-05-09', 1);
      const res = await request(testApp)
        .put(`/api/words/${insert.lastInsertRowid}`)
        .send({ english: 'kitten', chinese: '小猫' });

      expect(res.status).toBe(200);
      expect(res.body.english).toBe('kitten');
      expect(res.body.chinese).toBe('小猫');
    });

    it('should return 404 for non-existent word', async () => {
      const res = await request(testApp)
        .put('/api/words/999')
        .send({ english: 'x', chinese: 'x' });
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/words/:id', () => {
    it('should delete a word', async () => {
      const insert = db.prepare("INSERT INTO words (english, chinese, created_at, user_id) VALUES (?, ?, ?, ?)").run('cat', '猫', '2026-05-09', 1);
      const res = await request(testApp).delete(`/api/words/${insert.lastInsertRowid}`);
      expect(res.status).toBe(200);

      const row = db.prepare('SELECT * FROM words WHERE id = ?').get(insert.lastInsertRowid);
      expect(row).toBeUndefined();
    });

    it('should return 404 for non-existent word', async () => {
      const res = await request(testApp).delete('/api/words/999');
      expect(res.status).toBe(404);
    });
  });
});
