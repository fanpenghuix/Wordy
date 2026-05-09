import express from 'express';
import db from '../db.js';

const router = express.Router();

// GET /api/quiz/today — generate today's quiz list
router.get('/today', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);

  // Get today's new words (always included)
  const newWords = db.prepare('SELECT * FROM words WHERE created_at = ?').all(today);
  const newWordIds = new Set(newWords.map(w => w.id));

  // Get all other words
  const otherWords = db.prepare('SELECT * FROM words WHERE created_at != ?').all(today);

  // Select 15% of other words
  const count = Math.ceil(otherWords.length * 0.15);
  const shuffled = otherWords.sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, count);

  // Combine and shuffle again
  const quizWords = [...newWords, ...selected].sort(() => Math.random() - 0.5);

  res.json({ words: quizWords, total: quizWords.length });
});

// POST /api/quiz/record — record a quiz answer
router.post('/record', (req, res) => {
  const { word_id, correct } = req.body;
  const today = new Date().toISOString().slice(0, 10);

  if (!word_id || correct === undefined || correct === null) {
    return res.status(400).json({ error: 'word_id and correct are required' });
  }

  if (correct !== 0 && correct !== 1) {
    return res.status(400).json({ error: 'correct must be 0 or 1' });
  }

  const result = db.prepare(
    'INSERT INTO quiz_records (word_id, correct, quiz_date) VALUES (?, ?, ?)'
  ).run(word_id, correct, today);

  const record = db.prepare('SELECT * FROM quiz_records WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(record);
});

export default router;
