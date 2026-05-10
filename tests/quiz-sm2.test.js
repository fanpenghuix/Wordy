import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../src/server.js';
import db from '../src/db.js';
import bcrypt from 'bcrypt';

describe('Quiz API with SM-2', () => {
  let agent;
  let userId;

  beforeAll(async () => {
    agent = request.agent(app);
    // Create a test user and login
    db.prepare("DELETE FROM quiz_records WHERE user_id = (SELECT id FROM users WHERE username = 'quiz_test_user')").run();
    db.prepare("DELETE FROM sm2_reviews WHERE user_id = (SELECT id FROM users WHERE username = 'quiz_test_user')").run();
    db.prepare("DELETE FROM words WHERE user_id = (SELECT id FROM users WHERE username = 'quiz_test_user')").run();
    db.prepare("DELETE FROM users WHERE username = 'quiz_test_user'").run();
    const hash = await bcrypt.hash('testpass', 10);
    db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)").run('quiz_test_user', hash, 'user');
    userId = db.prepare("SELECT id FROM users WHERE username = 'quiz_test_user'").get().id;
    await agent.post('/api/auth/login').send({ username: 'quiz_test_user', password: 'testpass' });
  });

  it('GET /api/quiz/today returns 401 without auth', async () => {
    await request(app).get('/api/quiz/today').expect(401);
  });

  it('POST /api/quiz/record returns 401 without auth', async () => {
    await request(app).post('/api/quiz/record').send({ word_id: 1, correct: 1 }).expect(401);
  });

  it('POST /api/quiz/record returns 400 with missing fields', async () => {
    await agent.post('/api/quiz/record').send({}).expect(400);
  });

  it('POST /api/quiz/record returns 400 with invalid correct value', async () => {
    await agent.post('/api/quiz/record').send({ word_id: 1, correct: 2 }).expect(400);
  });
});
