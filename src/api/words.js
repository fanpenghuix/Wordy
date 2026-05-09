import express from 'express';
import db from '../db.js';

const router = express.Router();

// GET /api/words — list all words
router.get('/', (req, res) => {
  const words = db.prepare('SELECT * FROM words ORDER BY english').all();
  res.json(words);
});

// POST /api/words — add a word
router.post('/', (req, res) => {
  const { english, chinese } = req.body;
  if (!english || !chinese) {
    return res.status(400).json({ error: 'english and chinese are required' });
  }

  try {
    const result = db.prepare('INSERT INTO words (english, chinese) VALUES (?, ?)').run(english.trim(), chinese.trim());
    const word = db.prepare('SELECT * FROM words WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(word);
  } catch (err) {
    if (err.message.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: '该单词已存在' });
    }
    throw err;
  }
});

// PUT /api/words/:id — update a word
router.put('/:id', (req, res) => {
  const { english, chinese } = req.body;
  if (!english || !chinese) {
    return res.status(400).json({ error: 'english and chinese are required' });
  }

  const result = db.prepare('UPDATE words SET english = ?, chinese = ? WHERE id = ?')
    .run(english.trim(), chinese.trim(), Number(req.params.id));

  if (result.changes === 0) {
    return res.status(404).json({ error: 'Word not found' });
  }

  const word = db.prepare('SELECT * FROM words WHERE id = ?').get(Number(req.params.id));
  res.json(word);
});

// DELETE /api/words/:id — delete a word
router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM words WHERE id = ?').run(Number(req.params.id));

  if (result.changes === 0) {
    return res.status(404).json({ error: 'Word not found' });
  }

  res.json({ success: true });
});

export default router;
