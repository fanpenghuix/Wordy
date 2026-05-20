import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import path from 'path';
import bcrypt from 'bcrypt';
import express from 'express';
import session from 'express-session';
import request from 'supertest';

const testDbDir = process.env.DB_DIR;

const { default: db } = await import('../src/db.js');
import { default as authRouter } from '../src/api/auth.js';
import { default as settingsRouter } from '../src/api/settings.js';

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
  app.use('/api/settings', settingsRouter);
  return app;
}

async function seedUser(username = 'testuser', role = 'user') {
  const hash = bcrypt.hashSync('Test123456', 10);
  return db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(username, hash, role);
}

async function loginAs(agent, username, password) {
  const res = await agent.post('/api/auth/login').send({ username, password });
  return res;
}

describe('Settings API', () => {
  let app;

  beforeAll(() => {
    app = createTestApp();
  });

  beforeEach(async () => {
    db.exec('DELETE FROM user_preferences');
    db.exec('DELETE FROM quiz_records');
    db.exec('DELETE FROM sm2_reviews');
    db.exec('DELETE FROM words');
    // Clean up test users but not admin (created by other tests' beforeAll)
    db.exec("DELETE FROM users WHERE username NOT IN ('admin', 'testuser')");
    // Ensure testuser exists for this test file
    try {
      await seedUser();
    } catch (e) { /* already exists */ }
  });

  describe('GET /api/settings/voice', () => {
    it('should return 401 when not logged in', async () => {
      const res = await request(app).get('/api/settings/voice');
      expect(res.status).toBe(401);
    });

    it('should return defaults when no settings saved', async () => {
      const agent = request.agent(app);
      await loginAs(agent, 'testuser', 'Test123456');

      const res = await agent.get('/api/settings/voice');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ gender: 'female', voiceName: '', speed: '0.85' });
    });

    it('should return saved settings', async () => {
      const agent = request.agent(app);
      await loginAs(agent, 'testuser', 'Test123456');

      const uid = db.prepare('SELECT id FROM users WHERE username = ?').get('testuser').id;
      db.prepare('INSERT INTO user_preferences (user_id, key, value) VALUES (?, ?, ?)').run(uid, 'speakGender', 'male');
      db.prepare('INSERT INTO user_preferences (user_id, key, value) VALUES (?, ?, ?)').run(uid, 'speakSpeed', '1.2');

      const res = await agent.get('/api/settings/voice');
      expect(res.status).toBe(200);
      expect(res.body.gender).toBe('male');
      expect(res.body.speed).toBe('1.2');
    });
  });

  describe('PUT /api/settings/voice', () => {
    it('should return 401 when not logged in', async () => {
      const res = await request(app).put('/api/settings/voice').send({ gender: 'male' });
      expect(res.status).toBe(401);
    });

    it('should save voice settings', async () => {
      const agent = request.agent(app);
      await loginAs(agent, 'testuser', 'Test123456');

      const res = await agent.put('/api/settings/voice').send({
        gender: 'male',
        voiceName: 'en-GB-Chirp3-HD-Charon',
        speed: 1.0,
      });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const uid = db.prepare('SELECT id FROM users WHERE username = ?').get('testuser').id;
      const prefs = db.prepare('SELECT key, value FROM user_preferences WHERE user_id = ? ORDER BY key').all(uid);
      expect(prefs.map(p => [p.key, p.value])).toEqual([
        ['speakGender', 'male'],
        ['speakSpeed', '1'],
        ['speakVoiceName', 'en-GB-Chirp3-HD-Charon'],
      ]);
    });

    it('should reject invalid gender', async () => {
      const agent = request.agent(app);
      await loginAs(agent, 'testuser', 'Test123456');

      const res = await agent.put('/api/settings/voice').send({ gender: 'robot' });
      expect(res.status).toBe(400);
    });

    it('should reject invalid speed', async () => {
      const agent = request.agent(app);
      await loginAs(agent, 'testuser', 'Test123456');

      const res = await agent.put('/api/settings/voice').send({ speed: 99 });
      expect(res.status).toBe(400);
    });

    it('should allow partial updates', async () => {
      const agent = request.agent(app);
      await loginAs(agent, 'testuser', 'Test123456');

      await agent.put('/api/settings/voice').send({ gender: 'female' });

      const res = await agent.put('/api/settings/voice').send({ speed: 0.9 });
      expect(res.status).toBe(200);

      const uid = db.prepare('SELECT id FROM users WHERE username = ?').get('testuser').id;
      const prefs = db.prepare('SELECT key, value FROM user_preferences WHERE user_id = ? ORDER BY key').all(uid);
      expect(prefs.length).toBe(2);
      const genderPref = prefs.find(p => p.key === 'speakGender');
      const speedPref = prefs.find(p => p.key === 'speakSpeed');
      expect(genderPref.value).toBe('female');
      expect(speedPref.value).toBe('0.9');
    });

    it('should not affect other users', async () => {
      try { await seedUser('user1'); } catch (e) {}
      try { await seedUser('user2'); } catch (e) {}

      const agent1 = request.agent(app);
      const agent2 = request.agent(app);
      await loginAs(agent1, 'user1', 'Test123456');
      await loginAs(agent2, 'user2', 'Test123456');

      await agent1.put('/api/settings/voice').send({ gender: 'male', speed: 1.5 });
      await agent2.put('/api/settings/voice').send({ gender: 'female', speed: 0.7 });

      const res1 = await agent1.get('/api/settings/voice');
      const res2 = await agent2.get('/api/settings/voice');

      expect(res1.body.gender).toBe('male');
      expect(res1.body.speed).toBe('1.5');
      expect(res2.body.gender).toBe('female');
      expect(res2.body.speed).toBe('0.7');
    });
  });

  describe('GET /api/settings/all', () => {
    it('should return all preferences as key-value map', async () => {
      const agent = request.agent(app);
      await loginAs(agent, 'testuser', 'Test123456');

      const uid = db.prepare('SELECT id FROM users WHERE username = ?').get('testuser').id;
      db.prepare('INSERT INTO user_preferences (user_id, key, value) VALUES (?, ?, ?)').run(uid, 'speakGender', 'male');
      db.prepare('INSERT INTO user_preferences (user_id, key, value) VALUES (?, ?, ?)').run(uid, 'theme', 'dark');

      const res = await agent.get('/api/settings/all');
      expect(res.status).toBe(200);
      expect(res.body.speakGender).toBe('male');
      expect(res.body.theme).toBe('dark');
    });
  });
});
