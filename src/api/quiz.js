import express from 'express';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { getDueWords, recordResult } from '../algorithms/quizStrategy.js';

const router = express.Router();
router.use(requireAuth);

// GET /api/quiz/session — check if today's session exists, restore if so (do NOT create new)
router.get('/session', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);

  const session = db.prepare(
    `SELECT s.word_id, s.result, s.word_order FROM quiz_session s
     WHERE s.user_id = ? AND s.quiz_date = ?
     ORDER BY s.word_order ASC`
  ).all(req.userId, today);

  if (session.length === 0) {
    return res.json({ exists: false, words: [], results: [], total: 0 });
  }

  // Answered words first (by original order), then unanswered (by original order)
  const answered = session.filter(s => s.result !== null).sort((a, b) => a.word_order - b.word_order);
  const unanswered = session.filter(s => s.result === null).sort((a, b) => a.word_order - b.word_order);
  const ordered = [...answered, ...unanswered];
  const wordIds = ordered.map(s => s.word_id);
  const words = db.prepare(
    `SELECT * FROM words WHERE user_id = ? AND id IN (${wordIds.join(',')})`
  ).all(req.userId);
  const wordMap = {};
  for (const w of words) wordMap[w.id] = w;
  const orderedWords = ordered.map(s => wordMap[s.word_id]);
  const results = ordered.map(s => s.result);
  res.json({ exists: true, words: orderedWords, results, total: orderedWords.length });
});

// GET /api/quiz/today — generate or restore today's quiz list
router.get('/today', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);

  // Try to restore today's session
  const session = db.prepare(
    `SELECT s.word_id, s.result, s.word_order FROM quiz_session s
     WHERE s.user_id = ? AND s.quiz_date = ?
     ORDER BY s.word_order ASC`
  ).all(req.userId, today);

  if (session.length > 0) {
    // Shuffle restored session for varied order each visit
    const shuffled = session.sort(() => Math.random() - 0.5);
    const wordIds = shuffled.map(s => s.word_id);
    const words = db.prepare(
      `SELECT * FROM words WHERE user_id = ? AND id IN (${wordIds.join(',')})`
    ).all(req.userId);
    const wordMap = {};
    for (const w of words) wordMap[w.id] = w;
    const orderedWords = shuffled.map(s => wordMap[s.word_id]);
    const results = shuffled.map(s => s.result);
    return res.json({ words: orderedWords, results, total: orderedWords.length });
  }

  // New session
  const words = getDueWords(req.userId);
  if (words.length === 0) return res.json({ words: [], results: [], total: 0 });

  const tx = db.transaction((userId, date, items) => {
    db.prepare('DELETE FROM quiz_session WHERE user_id = ? AND quiz_date = ?').run(userId, date);
    const stmt = db.prepare(
      'INSERT OR REPLACE INTO quiz_session (user_id, quiz_date, word_id, word_order, result) VALUES (?, ?, ?, ?, NULL)'
    );
    for (let i = 0; i < items.length; i++) {
      stmt.run(userId, date, items[i].id, i);
    }
  });
  tx(req.userId, today, words);

  res.json({ words, results: new Array(words.length).fill(null), total: words.length });
});

// POST /api/quiz/record — record a quiz answer
router.post('/record', (req, res) => {
  const { word_id, correct, spellMode } = req.body;

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

  recordResult(req.userId, word_id, correct === 1, !!spellMode);

  // Update session result
  db.prepare(
    'UPDATE quiz_session SET result = ? WHERE user_id = ? AND quiz_date = ? AND word_id = ?'
  ).run(correct, req.userId, today, word_id);

  const record = db.prepare('SELECT * FROM quiz_records WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(record);
});

// POST /api/quiz/retry — reset today's session results for retry
router.post('/retry', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);

  db.prepare(
    'UPDATE quiz_session SET result = NULL WHERE user_id = ? AND quiz_date = ?'
  ).run(req.userId, today);

  const session = db.prepare(
    `SELECT s.word_id, s.word_order FROM quiz_session s
     WHERE s.user_id = ? AND s.quiz_date = ?`
  ).all(req.userId, today);

  if (session.length === 0) {
    return res.status(404).json({ error: 'No active session' });
  }

  // Shuffle for varied order on retry
  const shuffled = session.sort(() => Math.random() - 0.5);
  const wordIds = shuffled.map(s => s.word_id);
  const words = db.prepare(
    `SELECT * FROM words WHERE user_id = ? AND id IN (${wordIds.join(',')})`
  ).all(req.userId);
  const wordMap = {};
  for (const w of words) wordMap[w.id] = w;
  const orderedWords = shuffled.map(s => wordMap[s.word_id]);

  res.json({ words: orderedWords, results: new Array(orderedWords.length).fill(null), total: orderedWords.length });
});

export default router;
