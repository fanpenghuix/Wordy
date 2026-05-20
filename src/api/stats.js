import express from 'express';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { getSm2Stats, getSm2WordStats } from '../algorithms/sm2.js';

const router = express.Router();
router.use(requireAuth);

// GET /api/stats/word/:id — per-word accuracy
router.get('/word/:id', (req, res) => {
  const wordId = Number(req.params.id);
  const word = db.prepare('SELECT * FROM words WHERE id = ? AND user_id = ?').get(wordId, req.userId);
  if (!word) {
    return res.status(404).json({ error: 'Word not found' });
  }

  const stats = db.prepare(`
    SELECT COUNT(*) as total, SUM(correct) as correct
    FROM quiz_records WHERE word_id = ? AND user_id = ?
  `).get(wordId, req.userId);

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
    WHERE user_id = ?
    GROUP BY quiz_date
    ORDER BY quiz_date DESC
  `).all(req.userId);

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
      WHERE user_id = ?
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
      WHERE user_id = ?
      GROUP BY strftime('%Y-%W', quiz_date)
      ORDER BY label
    `;
  }

  const rows = db.prepare(query).all(req.userId);
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
    WHERE w.user_id = ? AND r.user_id = ?
    GROUP BY w.id
    ORDER BY accuracy ASC, total DESC
    LIMIT ?
  `).all(req.userId, req.userId, limit);

  res.json(rows);
});

// GET /api/stats/sm2 — SM-2 overview stats
router.get('/sm2', (req, res) => {
  const stats = getSm2Stats(req.userId);
  res.json(stats);
});

// GET /api/stats/sm2/words — per-word SM-2 state
router.get('/sm2/words', (req, res) => {
  const words = getSm2WordStats(req.userId);
  res.json(words);
});

export default router;
