import db from '../db.js';

const today = () => new Date().toISOString().slice(0, 10);

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function initSm2Review(userId, wordId) {
  const t = today();
  db.prepare(`
    INSERT INTO sm2_reviews (user_id, word_id, interval, efactor, repetitions, next_review)
    VALUES (?, ?, 0, 2.5, 0, ?)
    ON CONFLICT(user_id, word_id) DO NOTHING
  `).run(userId, wordId, t);
}

export function recordResult(userId, wordId, correct, hard = false) {
  const t = today();
  const review = db.prepare(
    'SELECT * FROM sm2_reviews WHERE user_id = ? AND word_id = ?'
  ).get(userId, wordId);

  if (!review) {
    if (hard) {
      db.prepare(`
        INSERT INTO sm2_reviews (user_id, word_id, interval, efactor, repetitions, next_review)
        VALUES (?, ?, 0, 2.2, 0, ?)
        ON CONFLICT(user_id, word_id) DO NOTHING
      `).run(userId, wordId, t);
    } else {
      initSm2Review(userId, wordId);
    }
    return recordResult(userId, wordId, correct, hard);
  }

  let { interval, efactor, repetitions } = review;

  if (correct) {
    if (repetitions === 0) interval = 1;
    else if (repetitions === 1) interval = hard ? 2 : 3;
    else interval = Math.round(interval * efactor * (hard ? 0.8 : 1));
    repetitions += 1;
  } else {
    repetitions = 0;
    interval = 0;
    efactor = Math.max(1.3, efactor - (hard ? 0.35 : 0.2));
  }

  const nextReview = correct ? addDays(t, interval) : t;

  db.prepare(`
    UPDATE sm2_reviews
    SET interval = ?, efactor = ?, repetitions = ?, next_review = ?, last_review = ?
    WHERE user_id = ? AND word_id = ?
  `).run(interval, efactor, repetitions, nextReview, t, userId, wordId);

  return { interval, efactor, repetitions, next_review: nextReview, last_review: t };
}

function getUserQuizLimit(userId) {
  const prefs = db.prepare('SELECT key, value FROM user_preferences WHERE user_id = ? AND key IN (?, ?)')
    .all(userId, 'quizLimitMode', 'quizLimitValue');
  const map = {};
  for (const p of prefs) map[p.key] = p.value;

  const mode = map.quizLimitMode ?? 'ratio';
  const value = Number(map.quizLimitValue ?? 20);
  const totalWords = getTotalWordCount(userId);

  if (mode === 'fixed') return value;
  return Math.ceil(totalWords * value / 100);
}

function getDueWords(userId, limit) {
  const t = today();
  const dailyLimit = limit ?? getUserQuizLimit(userId);

  const dueWords = db.prepare(`
    SELECT w.*, s.interval, s.efactor, s.repetitions, s.next_review,
           CASE WHEN s.last_review IS NULL OR s.repetitions = 0 THEN 1 ELSE 0 END as is_wrong
    FROM words w
    JOIN sm2_reviews s ON w.id = s.word_id AND w.user_id = s.user_id
    WHERE s.user_id = ? AND s.next_review <= ?
    ORDER BY is_wrong DESC, s.next_review ASC
    LIMIT ?
  `).all(userId, t, dailyLimit);

  const remaining = Math.max(0, dailyLimit - dueWords.length);
  const newWords = remaining > 0 ? db.prepare(`
    SELECT w.*, 0 as interval, 2.5 as efactor, 0 as repetitions, ? as next_review, 0 as is_wrong
    FROM words w
    WHERE w.user_id = ? AND w.id NOT IN (SELECT word_id FROM sm2_reviews WHERE user_id = ?)
    LIMIT ?
  `).all(t, userId, userId, remaining) : [];

  // If still under dailyLimit, fill with earliest upcoming reviews
  const fetched = dueWords.length + newWords.length;
  const extra = Math.max(0, dailyLimit - fetched);
  const existingIds = fetched > 0 ? [...dueWords, ...newWords].map(w => w.id) : [];
  const extraWords = extra > 0 && existingIds.length > 0 ? db.prepare(`
    SELECT w.*, s.interval, s.efactor, s.repetitions, s.next_review,
           CASE WHEN s.last_review IS NULL OR s.repetitions = 0 THEN 1 ELSE 0 END as is_wrong
    FROM words w
    JOIN sm2_reviews s ON w.id = s.word_id AND w.user_id = s.user_id
    WHERE s.user_id = ?
      AND s.next_review > ?
      AND w.id NOT IN (${existingIds.join(',')})
    ORDER BY s.next_review ASC
    LIMIT ?
  `).all(userId, t, extra) : extra > 0 ? db.prepare(`
    SELECT w.*, s.interval, s.efactor, s.repetitions, s.next_review,
           CASE WHEN s.last_review IS NULL OR s.repetitions = 0 THEN 1 ELSE 0 END as is_wrong
    FROM words w
    JOIN sm2_reviews s ON w.id = s.word_id AND w.user_id = s.user_id
    WHERE s.user_id = ? AND s.next_review > ?
    ORDER BY s.next_review ASC
    LIMIT ?
  `).all(userId, t, extra) : [];

  const allWords = [...dueWords, ...newWords, ...extraWords];
  // Randomize order so repeated quizzes aren't predictable
  return allWords.sort(() => Math.random() - 0.5);
}

function getTotalWordCount(userId) {
  return db.prepare('SELECT COUNT(*) as count FROM words WHERE user_id = ?').get(userId).count;
}

export { getDueWords as getSm2DueWords, getUserQuizLimit };

export function getSm2Stats(userId) {
  const total = db.prepare('SELECT COUNT(*) as count FROM sm2_reviews WHERE user_id = ?').get(userId).count;
  const stageDist = db.prepare(`
    SELECT CASE
      WHEN repetitions = 0 THEN '新词/错词'
      WHEN repetitions = 1 THEN '学习中'
      WHEN repetitions = 2 THEN '熟悉'
      ELSE '已掌握'
    END as stage, COUNT(*) as count
    FROM sm2_reviews WHERE user_id = ? GROUP BY stage
  `).all(userId);
  const avgEfactor = db.prepare('SELECT AVG(efactor) as avg FROM sm2_reviews WHERE user_id = ?').get(userId).avg;
  const dueToday = db.prepare('SELECT COUNT(*) as count FROM sm2_reviews WHERE user_id = ? AND next_review <= ?').get(userId, today()).count;
  return { total, stageDist, avgEfactor: avgEfactor ? Math.round(avgEfactor * 100) / 100 : 0, dueToday };
}

export function getSm2WordStats(userId) {
  return db.prepare(`
    SELECT w.id, w.english, w.chinese, s.interval, s.efactor, s.repetitions, s.next_review, s.last_review
    FROM words w JOIN sm2_reviews s ON w.id = s.word_id AND w.user_id = s.user_id
    WHERE w.user_id = ? ORDER BY s.next_review ASC
  `).all(userId);
}
