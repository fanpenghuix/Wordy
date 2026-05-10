import express from 'express';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { getDueWords, recordResult } from '../algorithms/quizStrategy.js';

const router = express.Router();
router.use(requireAuth);

// GET /api/quiz/today — generate today's quiz list
router.get('/today', (req, res) => {
  const words = getDueWords(req.userId);
  res.json({ words, total: words.length });
});

// POST /api/quiz/record — record a quiz answer
router.post('/record', (req, res) => {
  const { word_id, correct } = req.body;

  if (!word_id || correct === undefined || correct === null) {
    return res.status(400).json({ error: 'word_id and correct are required' });
  }

  if (correct !== 0 && correct !== 1) {
    return res.status(400).json({ error: 'correct must be 0 or 1' });
  }

  const today = new Date().toISOString().slice(0, 10);

  const result = db.prepare(
    'INSERT INTO quiz_records (word_id, correct, quiz_date, user_id) VALUES (?, ?, ?, ?)'
  ).run(word_id, correct, today, req.userId);

  recordResult(req.userId, word_id, correct === 1);

  const record = db.prepare('SELECT * FROM quiz_records WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(record);
});

export default router;
