import express from 'express';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const words = db.prepare('SELECT * FROM words WHERE user_id = ? ORDER BY english').all(req.userId);
  res.json(words);
});

router.post('/', (req, res) => {
  const { english, chinese } = req.body;
  if (!english || !chinese) {
    return res.status(400).json({ error: 'english and chinese are required' });
  }

  try {
    const result = db.prepare('INSERT INTO words (english, chinese, user_id) VALUES (?, ?, ?)').run(english.trim(), chinese.trim(), req.userId);
    const word = db.prepare('SELECT * FROM words WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(word);
  } catch (err) {
    if (err.message.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: '该单词已存在' });
    }
    throw err;
  }
});

router.put('/:id', (req, res) => {
  const { english, chinese } = req.body;
  if (!english || !chinese) {
    return res.status(400).json({ error: 'english and chinese are required' });
  }

  const result = db.prepare('UPDATE words SET english = ?, chinese = ? WHERE id = ? AND user_id = ?')
    .run(english.trim(), chinese.trim(), Number(req.params.id), req.userId);

  if (result.changes === 0) {
    return res.status(404).json({ error: 'Word not found' });
  }

  const word = db.prepare('SELECT * FROM words WHERE id = ?').get(Number(req.params.id));
  res.json(word);
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM quiz_records WHERE word_id = ?').run(id);
  const result = db.prepare('DELETE FROM words WHERE id = ? AND user_id = ?').run(id, req.userId);

  if (result.changes === 0) {
    return res.status(404).json({ error: 'Word not found' });
  }

  res.json({ success: true });
});

export default router;
