import express from 'express';
import db from '../db.js';

const router = express.Router();

// GET /api/stats/word/:id — per-word accuracy
router.get('/word/:id', (req, res) => {
  const wordId = Number(req.params.id);
  const word = db.prepare('SELECT * FROM words WHERE id = ?').get(wordId);
  if (!word) {
    return res.status(404).json({ error: 'Word not found' });
  }

  const stats = db.prepare(`
    SELECT COUNT(*) as total, SUM(correct) as correct
    FROM quiz_records WHERE word_id = ?
  `).get(wordId);

  const total = stats.total || 0;
  const correct = stats.correct || 0;
  const accuracy = total > 0 ? correct / total : 0;

  res.json({ ...word, total, correct, accuracy: Math.round(accuracy * 1000) / 1000 });
});

// GET /api/stats/daily — daily report
router.get('/daily', (req, res) => {
  const rows = db.prepare(`
    SELECT
      quiz_date as date,
      COUNT(*) as total,
      SUM(correct) as correct,
      ROUND(CAST(SUM(correct) AS FLOAT) / COUNT(*), 3) as accuracy
    FROM quiz_records
    GROUP BY quiz_date
    ORDER BY quiz_date DESC
  `).all();

  res.json(rows);
});

// GET /api/stats/trend — trend data (weekly/monthly)
router.get('/trend', (req, res) => {
  const period = req.query.period || 'week';

  let query;
  if (period === 'month') {
    query = `
      SELECT
        strftime('%Y-%m', quiz_date) as label,
        COUNT(*) as total,
        SUM(correct) as correct,
        ROUND(CAST(SUM(correct) AS FLOAT) / COUNT(*), 3) as accuracy
      FROM quiz_records
      GROUP BY strftime('%Y-%m', quiz_date)
      ORDER BY label
    `;
  } else {
    // Weekly: group by week number
    query = `
      SELECT
        'W' || strftime('%W', quiz_date) || '-' || strftime('%Y', quiz_date) as label,
        COUNT(*) as total,
        SUM(correct) as correct,
        ROUND(CAST(SUM(correct) AS FLOAT) / COUNT(*), 3) as accuracy
      FROM quiz_records
      GROUP BY strftime('%Y-%W', quiz_date)
      ORDER BY label
    `;
  }

  const rows = db.prepare(query).all();
  res.json(rows);
});

// GET /api/stats/worst — wrong-word ranking
router.get('/worst', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 10, 100);

  const rows = db.prepare(`
    SELECT
      w.id, w.english, w.chinese,
      COUNT(*) as total,
      SUM(r.correct) as correct,
      ROUND(CAST(SUM(r.correct) AS FLOAT) / COUNT(*), 3) as accuracy
    FROM words w
    JOIN quiz_records r ON w.id = r.word_id
    GROUP BY w.id
    ORDER BY accuracy ASC, total DESC
    LIMIT ?
  `).all(limit);

  res.json(rows);
});

export default router;
