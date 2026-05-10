import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import express from 'express';
import session from 'express-session';
import request from 'supertest';

const testDbDir = path.join(process.cwd(), 'data-test-users');
process.env.DB_DIR = testDbDir;

const { default: db } = await import('../src/db.js');
import { default as usersRouter } from '../src/api/users.js';

function createTestApp(sessionData = {}) {
  const app = express();
  app.use(express.json());
  app.use(session({
    secret: 'test-secret',
    resave: false,
    saveUninitialized: false,
    store: new session.MemoryStore(),
  }));
  app.use((req, res, next) => {
    if (sessionData.userId) {
      req.session.userId = sessionData.userId;
      req.session.username = sessionData.username || 'admin';
      req.session.role = sessionData.role || 'admin';
    }
    next();
  });
  app.use('/api/users', usersRouter);
  return app;
}

describe('Users API', () => {
  let adminApp;
  let userApp;

  beforeAll(() => {
    adminApp = createTestApp({ userId: 1, username: 'admin', role: 'admin' });
    userApp = createTestApp({ userId: 2, username: 'bob', role: 'user' });
  });

  beforeEach(() => {
    db.exec('DELETE FROM quiz_records');
    db.exec('DELETE FROM words');
    db.exec('DELETE FROM users');
    db.exec("DELETE FROM sqlite_sequence WHERE name='words'");
    // Don't reset users sequence so IDs keep incrementing and don't collide with session userId=1
  });

  afterAll(() => {
    db.close();
    fs.rmSync(testDbDir, { recursive: true, force: true });
  });

  describe('GET /api/users', () => {
    it('should list all users (admin only)', async () => {
      db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)").run('admin', 'hash1', 'admin');
      db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)").run('bob', 'hash2', 'user');

      const res = await request(adminApp).get('/api/users');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(res.body[0]).not.toHaveProperty('password_hash');
    });

    it('should return 403 for non-admin', async () => {
      const res = await request(userApp).get('/api/users');
      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/users', () => {
    it('should create a user (admin only)', async () => {
      const res = await request(adminApp)
        .post('/api/users')
        .send({ username: 'alice', password: 'AlicePass1', role: 'user' });

      expect(res.status).toBe(201);
      expect(res.body.user.username).toBe('alice');
      expect(res.body.user.role).toBe('user');
      expect(res.body.user).not.toHaveProperty('password_hash');
    });

    it('should return 403 for non-admin', async () => {
      const res = await request(userApp)
        .post('/api/users')
        .send({ username: 'eve', password: 'EvePass1', role: 'user' });

      expect(res.status).toBe(403);
    });

    it('should return 409 for duplicate username', async () => {
      await request(adminApp)
        .post('/api/users')
        .send({ username: 'alice', password: 'AlicePass1', role: 'user' });

      const res = await request(adminApp)
        .post('/api/users')
        .send({ username: 'alice', password: 'AlicePass2', role: 'user' });

      expect(res.status).toBe(409);
    });
  });

  describe('PUT /api/users/:id', () => {
    it('should update a user', async () => {
      const insert = db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)").run('bob', '$2b$10$dummy', 'user');
      const res = await request(adminApp)
        .put(`/api/users/${insert.lastInsertRowid}`)
        .send({ username: 'bobby', role: 'admin' });

      expect(res.status).toBe(200);
      expect(res.body.user.username).toBe('bobby');
      expect(res.body.user.role).toBe('admin');
    });

    it('should update password if provided', async () => {
      const insert = db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)").run('carol', '$2b$10$dummy', 'user');
      const res = await request(adminApp)
        .put(`/api/users/${insert.lastInsertRowid}`)
        .send({ password: 'NewCarol1' });

      expect(res.status).toBe(200);
      const bcrypt = await import('bcrypt');
      const user = db.prepare('SELECT * FROM users WHERE username = ?').get('carol');
      const valid = await bcrypt.compare('NewCarol1', user.password_hash);
      expect(valid).toBe(true);
    });

    it('should not allow admin to modify themselves', async () => {
      const res = await request(adminApp)
        .put('/api/users/1')
        .send({ role: 'user' });

      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /api/users/:id', () => {
    it('should delete a user and their data', async () => {
      const insert = db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)").run('temp', '$2b$10$dummy', 'user');
      const tempId = insert.lastInsertRowid;

      const res = await request(adminApp).delete(`/api/users/${tempId}`);
      expect(res.status).toBe(200);

      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(tempId);
      expect(user).toBeUndefined();
    });

    it('should not allow deleting self', async () => {
      const res = await request(adminApp).delete('/api/users/1');
      expect(res.status).toBe(400);
    });
  });
});
