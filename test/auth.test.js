import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import express from 'express';
import session from 'express-session';
import request from 'supertest';

const testDbDir = path.join(process.cwd(), 'data-test-auth');
process.env.DB_DIR = testDbDir;

const { default: db } = await import('../src/db.js');
import { default as authRouter } from '../src/api/auth.js';

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(session({
    secret: 'test-secret',
    resave: false,
    saveUninitialized: false,
    store: new session.MemoryStore(),
  }));
  app.use('/api/auth', authRouter);
  return app;
}

describe('Auth API', () => {
  let app;

  beforeAll(() => {
    app = createTestApp();
  });

  beforeEach(() => {
    db.exec('DELETE FROM user_preferences');
    db.exec('DELETE FROM quiz_records');
    db.exec('DELETE FROM words');
    db.exec('DELETE FROM users');
    db.exec("DELETE FROM sqlite_sequence WHERE name='users'");
    db.exec("DELETE FROM sqlite_sequence WHERE name='words'");
  });

  afterAll(() => {
    db.close();
    fs.rmSync(testDbDir, { recursive: true, force: true });
  });

  describe('POST /api/auth/login', () => {
    it('should login with correct credentials', async () => {
      const bcrypt = await import('bcrypt');
      const hash = bcrypt.hashSync('Admin123456', 10);
      db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run('admin', hash, 'admin');

      const res = await request(app)
        .post('/api/auth/login')
        .send({ username: 'admin', password: 'Admin123456' });

      expect(res.status).toBe(200);
      expect(res.body.user.username).toBe('admin');
      expect(res.body.user.role).toBe('admin');
    });

    it('should return 401 for wrong password', async () => {
      const bcrypt = await import('bcrypt');
      const hash = bcrypt.hashSync('Admin123456', 10);
      db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run('admin', hash, 'admin');

      const res = await request(app)
        .post('/api/auth/login')
        .send({ username: 'admin', password: 'wrong' });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('用户名或密码错误');
    });

    it('should return 401 for non-existent user', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ username: 'nobody', password: 'x' });

      expect(res.status).toBe(401);
    });

    it('should return 400 for missing fields', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ username: 'admin' });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/auth/me', () => {
    it('should return 401 when not logged in', async () => {
      const res = await request(app).get('/api/auth/me');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/auth/logout', () => {
    it('should destroy session', async () => {
      const jar = request.agent(app);

      const bcrypt = await import('bcrypt');
      const hash = bcrypt.hashSync('Admin123456', 10);
      db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run('admin', hash, 'admin');

      const loginRes = await jar.post('/api/auth/login').send({ username: 'admin', password: 'Admin123456' });
      expect(loginRes.status).toBe(200);

      const meRes = await jar.get('/api/auth/me');
      expect(meRes.status).toBe(200);

      const logoutRes = await jar.post('/api/auth/logout');
      expect(logoutRes.status).toBe(200);

      const afterLogout = await jar.get('/api/auth/me');
      expect(afterLogout.status).toBe(401);
    });
  });
});
