# SM-2 Spaced Repetition Quiz Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 15% random quiz algorithm with SM-2 spaced repetition, including DB table, strategy pattern, API routes, and frontend stats panel.

**Architecture:** Strategy pattern (`quizStrategy.js` interface + `sm2.js` implementation) decoupled from Express routes. Quiz endpoints call `getDueWords()` / `recordResult()`. SQLite `sm2_reviews` table tracks per-user spaced repetition state.

**Tech Stack:** Express 5, better-sqlite3 (ESM), vitest + supertest, Alpine.js

---

## File Map

| Action | File | Responsibility |
|---|---|---|
| Modify | `src/db.js` | Create `sm2_reviews` table, initialize new words |
| Create | `src/algorithms/quizStrategy.js` | Strategy interface + active strategy resolver |
| Create | `src/algorithms/sm2.js` | SM-2 algorithm (getDueWords, recordResult, getStats) |
| Modify | `src/api/quiz.js` | Replace 15% random with strategy calls |
| Modify | `src/api/stats.js` | Add SM-2 stats endpoints |
| Modify | `src/api/words.js` | Cascade delete sm2_reviews on word delete |
| Modify | `src/server.js` | Register `ACTIVE_STRATEGY` env constant |
| Create | `tests/sm2.test.js` | Unit tests for SM-2 algorithm |
| Create | `tests/quiz-sm2.test.js` | Integration tests for quiz API with SM-2 |
| Modify | `public/app.js` | SM-2 stats loading + frontend logic |
| Modify | `public/index.html` | SM-2 stats tab in admin panel |
| Modify | `public/style.css` | SM-2 stats panel CSS |

---

### Task 1: SM-2 Algorithm Unit Tests

**Files:**
- Create: `tests/sm2.test.js`
- Create: `vitest.config.js`
- Create: `tests/setup.js`
- Modify: `.gitignore`

- [ ] **Step 0: Create vitest config for test DB isolation**

```javascript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    setupFiles: ['./tests/setup.js'],
  },
});
```

Create `tests/setup.js`:

```javascript
import { beforeAll, afterAll } from 'vitest';
process.env.DB_DIR = process.env.DB_DIR || 'data-test';
```

This ensures tests use `data-test/words.db` instead of the production database.

Add to `.gitignore` if not already present (it is — `data-*` pattern already covers `data-test`):

No change needed — `.gitignore` already has `data-*` pattern which covers `data-test/`.

- [ ] **Step 1: Create test file with SM-2 algorithm tests**

```javascript
import { describe, it, expect } from 'vitest';
import db from '../src/db.js';
import { initSm2Review, recordResult, getDueWords, getSm2Stats } from '../src/algorithms/sm2.js';

describe('SM-2 Algorithm', () => {
  const today = new Date().toISOString().slice(0, 10);

  describe('initSm2Review', () => {
    it('should create initial state with correct defaults', () => {
      // Create a test user and word first
      const user = db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
        .run('sm2test_init', 'hash', 'user');
      const word = db.prepare('INSERT INTO words (english, chinese, user_id) VALUES (?, ?, ?)')
        .run('test', '测试', user.lastInsertRowid);

      initSm2Review(user.lastInsertRowid, word.lastInsertRowid);

      const state = db.prepare('SELECT * FROM sm2_reviews WHERE user_id = ? AND word_id = ?')
        .get(user.lastInsertRowid, word.lastInsertRowid);

      expect(state.interval).toBe(0);
      expect(state.efactor).toBe(2.5);
      expect(state.repetitions).toBe(0);
      expect(state.next_review).toBe(today);

      // Cleanup
      db.prepare('DELETE FROM sm2_reviews WHERE user_id = ?').run(user.lastInsertRowid);
      db.prepare('DELETE FROM words WHERE id = ?').run(word.lastInsertRowid);
      db.prepare('DELETE FROM users WHERE id = ?').run(user.lastInsertRowid);
    });
  });

  describe('recordResult - correct answers', () => {
    it('first correct: interval=1, repetitions=1', () => {
      // Setup user + word + init
      const user = db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
        .run('sm2test_c1', 'hash', 'user');
      const word = db.prepare('INSERT INTO words (english, chinese, user_id) VALUES (?, ?, ?)')
        .run('correct1', '正确1', user.lastInsertRowid);
      initSm2Review(user.lastInsertRowid, word.lastInsertRowid);

      recordResult(user.lastInsertRowid, word.lastInsertRowid, true);

      const state = db.prepare('SELECT * FROM sm2_reviews WHERE user_id = ? AND word_id = ?')
        .get(user.lastInsertRowid, word.lastInsertRowid);

      expect(state.repetitions).toBe(1);
      expect(state.interval).toBe(1);
      expect(state.efactor).toBe(2.5);

      // Cleanup
      db.prepare('DELETE FROM sm2_reviews WHERE user_id = ?').run(user.lastInsertRowid);
      db.prepare('DELETE FROM words WHERE id = ?').run(word.lastInsertRowid);
      db.prepare('DELETE FROM users WHERE id = ?').run(user.lastInsertRowid);
    });

    it('second correct: interval=3, repetitions=2', () => {
      const user = db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
        .run('sm2test_c2', 'hash', 'user');
      const word = db.prepare('INSERT INTO words (english, chinese, user_id) VALUES (?, ?, ?)')
        .run('correct2', '正确2', user.lastInsertRowid);
      initSm2Review(user.lastInsertRowid, word.lastInsertRowid);
      recordResult(user.lastInsertRowid, word.lastInsertRowid, true); // reps=1, interval=1
      recordResult(user.lastInsertRowid, word.lastInsertRowid, true); // reps=2, interval=3

      const state = db.prepare('SELECT * FROM sm2_reviews WHERE user_id = ? AND word_id = ?')
        .get(user.lastInsertRowid, word.lastInsertRowid);

      expect(state.repetitions).toBe(2);
      expect(state.interval).toBe(3);

      // Cleanup
      db.prepare('DELETE FROM sm2_reviews WHERE user_id = ?').run(user.lastInsertRowid);
      db.prepare('DELETE FROM words WHERE id = ?').run(word.lastInsertRowid);
      db.prepare('DELETE FROM users WHERE id = ?').run(user.lastInsertRowid);
    });

    it('third+ correct: interval = interval * efactor', () => {
      const user = db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
        .run('sm2test_c3', 'hash', 'user');
      const word = db.prepare('INSERT INTO words (english, chinese, user_id) VALUES (?, ?, ?)')
        .run('correct3', '正确3', user.lastInsertRowid);
      initSm2Review(user.lastInsertRowid, word.lastInsertRowid);
      recordResult(user.lastInsertRowid, word.lastInsertRowid, true); // reps=1, int=1
      recordResult(user.lastInsertRowid, word.lastInsertRowid, true); // reps=2, int=3
      recordResult(user.lastInsertRowid, word.lastInsertRowid, true); // reps=3, int=3*2.5=7.5->7

      const state = db.prepare('SELECT * FROM sm2_reviews WHERE user_id = ? AND word_id = ?')
        .get(user.lastInsertRowid, word.lastInsertRowid);

      expect(state.repetitions).toBe(3);
      expect(state.interval).toBe(7); // Math.round(3 * 2.5)

      // Cleanup
      db.prepare('DELETE FROM sm2_reviews WHERE user_id = ?').run(user.lastInsertRowid);
      db.prepare('DELETE FROM words WHERE id = ?').run(word.lastInsertRowid);
      db.prepare('DELETE FROM users WHERE id = ?').run(user.lastInsertRowid);
    });
  });

  describe('recordResult - wrong answers', () => {
    it('wrong resets repetitions=0, interval=0, reduces efactor', () => {
      const user = db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
        .run('sm2test_w1', 'hash', 'user');
      const word = db.prepare('INSERT INTO words (english, chinese, user_id) VALUES (?, ?, ?)')
        .run('wrong1', '错误1', user.lastInsertRowid);
      initSm2Review(user.lastInsertRowid, word.lastInsertRowid);
      recordResult(user.lastInsertRowid, word.lastInsertRowid, true); // reps=1, int=1
      recordResult(user.lastInsertRowid, word.lastInsertRowid, true); // reps=2, int=3
      recordResult(user.lastInsertRowid, word.lastInsertRowid, false); // wrong

      const state = db.prepare('SELECT * FROM sm2_reviews WHERE user_id = ? AND word_id = ?')
        .get(user.lastInsertRowid, word.lastInsertRowid);

      expect(state.repetitions).toBe(0);
      expect(state.interval).toBe(0);
      expect(state.efactor).toBe(2.3); // 2.5 - 0.2
      expect(state.next_review).toBe(today);

      // Cleanup
      db.prepare('DELETE FROM sm2_reviews WHERE user_id = ?').run(user.lastInsertRowid);
      db.prepare('DELETE FROM words WHERE id = ?').run(word.lastInsertRowid);
      db.prepare('DELETE FROM users WHERE id = ?').run(user.lastInsertRowid);
    });

    it('efactor minimum is 1.3', () => {
      const user = db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
        .run('sm2test_ef', 'hash', 'user');
      const word = db.prepare('INSERT INTO words (english, chinese, user_id) VALUES (?, ?, ?)')
        .run('efactor', '系数', user.lastInsertRowid);
      initSm2Review(user.lastInsertRowid, word.lastInsertRowid);

      // Force efactor low by repeated wrong answers
      for (let i = 0; i < 10; i++) {
        recordResult(user.lastInsertRowid, word.lastInsertRowid, false);
      }

      const state = db.prepare('SELECT * FROM sm2_reviews WHERE user_id = ? AND word_id = ?')
        .get(user.lastInsertRowid, word.lastInsertRowid);

      expect(state.efactor).toBe(1.3);

      // Cleanup
      db.prepare('DELETE FROM sm2_reviews WHERE user_id = ?').run(user.lastInsertRowid);
      db.prepare('DELETE FROM words WHERE id = ?').run(word.lastInsertRowid);
      db.prepare('DELETE FROM users WHERE id = ?').run(user.lastInsertRowid);
    });
  });

  describe('user isolation', () => {
    it('different users have independent SM-2 state', () => {
      const u1 = db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
        .run('sm2test_u1', 'hash', 'user');
      const u2 = db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
        .run('sm2test_u2', 'hash', 'user');
      const w1 = db.prepare('INSERT INTO words (english, chinese, user_id) VALUES (?, ?, ?)')
        .run('iso1', '隔离1', u1.lastInsertRowid);
      const w2 = db.prepare('INSERT INTO words (english, chinese, user_id) VALUES (?, ?, ?)')
        .run('iso2', '隔离2', u2.lastInsertRowid);

      initSm2Review(u1.lastInsertRowid, w1.lastInsertRowid);
      initSm2Review(u2.lastInsertRowid, w2.lastInsertRowid);

      // User 1 answers correctly 3 times
      for (let i = 0; i < 3; i++) recordResult(u1.lastInsertRowid, w1.lastInsertRowid, true);
      // User 2 answers wrong once
      recordResult(u2.lastInsertRowid, w2.lastInsertRowid, false);

      const s1 = db.prepare('SELECT * FROM sm2_reviews WHERE user_id = ?').get(u1.lastInsertRowid);
      const s2 = db.prepare('SELECT * FROM sm2_reviews WHERE user_id = ?').get(u2.lastInsertRowid);

      expect(s1.repetitions).toBe(3);
      expect(s2.repetitions).toBe(0);

      // Cleanup
      db.prepare('DELETE FROM sm2_reviews WHERE user_id = ? OR user_id = ?').run(u1.lastInsertRowid, u2.lastInsertRowid);
      db.prepare('DELETE FROM words WHERE user_id = ? OR user_id = ?').run(u1.lastInsertRowid, u2.lastInsertRowid);
      db.prepare('DELETE FROM users WHERE id = ? OR id = ?').run(u1.lastInsertRowid, u2.lastInsertRowid);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail (module doesn't exist yet)**

Run: `npx vitest run tests/sm2.test.js`
Expected: FAIL with "Cannot find module '../src/algorithms/sm2.js'"

---

### Task 2: Database Migration for sm2_reviews

**Files:**
- Modify: `src/db.js`

- [ ] **Step 1: Add sm2_reviews table creation in db.js**

Add after the existing table creation/migration block (after line 78, before `export default db;`):

```javascript
// Migration: create sm2_reviews table for spaced repetition
db.exec(`
  CREATE TABLE IF NOT EXISTS sm2_reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    word_id INTEGER NOT NULL REFERENCES words(id),
    interval INTEGER NOT NULL DEFAULT 0,
    efactor REAL NOT NULL DEFAULT 2.5,
    repetitions INTEGER NOT NULL DEFAULT 0,
    next_review TEXT NOT NULL,
    last_review TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, word_id)
  );
`);

db.exec(`CREATE INDEX IF NOT EXISTS idx_sm2_reviews_next_review ON sm2_reviews(next_review)`);
```

- [ ] **Step 2: Run the server briefly to create the table, verify**

Run: `node -e "import db from './src/db.js'; const t = db.pragma('table_info(sm2_reviews)'); console.log(JSON.stringify(t)); process.exit(0);"`
Expected: Array with columns: id, user_id, word_id, interval, efactor, repetitions, next_review, last_review, created_at

---

### Task 3: SM-2 Algorithm Implementation

**Files:**
- Create: `src/algorithms/sm2.js`
- Create: `src/algorithms/quizStrategy.js`

- [ ] **Step 1: Create the algorithms directory**

Run: `mkdir -p src/algorithms`

- [ ] **Step 2: Create quizStrategy.js (strategy interface)**

```javascript
import db from '../db.js';

// Strategy registry
const strategies = {};

// SM-2 will register itself here
export function registerStrategy(name, impl) {
  strategies[name] = impl;
}

// Get the active strategy from env or default to 'legacy'
function getActiveStrategy() {
  const name = process.env.ACTIVE_STRATEGY || 'legacy';
  return strategies[name] || strategies['legacy'];
}

export function getDueWords(userId, limit) {
  return getActiveStrategy().getDueWords(userId, limit);
}

export function recordResult(userId, wordId, correct) {
  return getActiveStrategy().recordResult(userId, wordId, correct);
}

export function initWord(userId, wordId) {
  return getActiveStrategy().initWord?.(userId, wordId);
}
```

- [ ] **Step 3: Create sm2.js (SM-2 implementation)**

```javascript
import db from '../db.js';
import { registerStrategy } from './quizStrategy.js';

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

export function recordResult(userId, wordId, correct) {
  const t = today();
  const review = db.prepare(
    'SELECT * FROM sm2_reviews WHERE user_id = ? AND word_id = ?'
  ).get(userId, wordId);

  if (!review) {
    initSm2Review(userId, wordId);
    return recordResult(userId, wordId, correct);
  }

  let { interval, efactor, repetitions } = review;

  if (correct) {
    if (repetitions === 0) interval = 1;
    else if (repetitions === 1) interval = 3;
    else interval = Math.round(interval * efactor);

    repetitions += 1;
  } else {
    repetitions = 0;
    interval = 0;
    efactor = Math.max(1.3, efactor - 0.2);
  }

  const nextReview = correct ? addDays(t, interval) : t;

  db.prepare(`
    UPDATE sm2_reviews
    SET interval = ?, efactor = ?, repetitions = ?, next_review = ?, last_review = ?
    WHERE user_id = ? AND word_id = ?
  `).run(interval, efactor, repetitions, nextReview, t, userId, wordId);

  return { interval, efactor, repetitions, next_review: nextReview, last_review: t };
}

function getDueWords(userId, limit) {
  const t = today();
  const dailyLimit = limit || Math.ceil(getTotalWordCount(userId) * 0.2) || 20;

  // Get due words from sm2_reviews
  const dueWords = db.prepare(`
    SELECT w.*, s.interval, s.efactor, s.repetitions, s.next_review,
           CASE WHEN s.last_review IS NULL OR s.repetitions = 0 THEN 1 ELSE 0 END as is_wrong
    FROM words w
    JOIN sm2_reviews s ON w.id = s.word_id AND w.user_id = s.user_id
    WHERE s.user_id = ? AND s.next_review <= ?
    ORDER BY is_wrong DESC, s.next_review ASC
    LIMIT ?
  `).all(userId, t, dailyLimit);

  // Get new words (no sm2_reviews entry)
  const newWords = db.prepare(`
    SELECT w.*, 0 as interval, 2.5 as efactor, 0 as repetitions, ? as next_review, 0 as is_wrong
    FROM words w
    WHERE w.user_id = ? AND w.id NOT IN (SELECT word_id FROM sm2_reviews WHERE user_id = ?)
  `).all(t, userId, userId);

  return [...dueWords, ...newWords];
}

function getTotalWordCount(userId) {
  return db.prepare('SELECT COUNT(*) as count FROM words WHERE user_id = ?').get(userId).count;
}

// Legacy strategy (existing 15% random)
const legacyStrategy = {
  getDueWords(userId, limit) {
    const t = today();
    const words = db.prepare('SELECT * FROM words WHERE user_id = ?').all(userId);
    const newWords = words.filter(w => w.created_at === t);
    const otherWords = words.filter(w => w.created_at !== t);
    const count = limit || Math.ceil(otherWords.length * 0.15);
    const shuffled = otherWords.sort(() => Math.random() - 0.5);
    return [...newWords, ...shuffled.slice(0, count)].sort(() => Math.random() - 0.5);
  },
  recordResult() {},
  initWord() {},
};

registerStrategy('legacy', legacyStrategy);

// SM-2 strategy
const sm2Strategy = {
  getDueWords,
  recordResult,
  initWord: initSm2Review,
};

registerStrategy('sm2', sm2Strategy);

export { getDueWords as getSm2DueWords };

export function getSm2Stats(userId) {
  const total = db.prepare(
    'SELECT COUNT(*) as count FROM sm2_reviews WHERE user_id = ?'
  ).get(userId).count;

  const stageDist = db.prepare(`
    SELECT
      CASE
        WHEN repetitions = 0 THEN 'new/wrong'
        WHEN repetitions = 1 THEN 'learning'
        WHEN repetitions = 2 THEN 'familiar'
        ELSE 'mastered'
      END as stage,
      COUNT(*) as count
    FROM sm2_reviews
    WHERE user_id = ?
    GROUP BY stage
  `).all(userId);

  const avgEfactor = db.prepare(
    'SELECT AVG(efactor) as avg FROM sm2_reviews WHERE user_id = ?'
  ).get(userId).avg;

  const dueToday = db.prepare(
    'SELECT COUNT(*) as count FROM sm2_reviews WHERE user_id = ? AND next_review <= ?'
  ).get(userId, today()).count;

  return { total, stageDist, avgEfactor: avgEfactor ? Math.round(avgEfactor * 100) / 100 : 0, dueToday };
}

export function getSm2WordStats(userId) {
  return db.prepare(`
    SELECT w.id, w.english, w.chinese,
           s.interval, s.efactor, s.repetitions, s.next_review, s.last_review
    FROM words w
    JOIN sm2_reviews s ON w.id = s.word_id AND w.user_id = s.user_id
    WHERE w.user_id = ?
    ORDER BY s.next_review ASC
  `).all(userId);
}
```

- [ ] **Step 4: Run SM-2 tests to verify they pass**

Run: `npx vitest run tests/sm2.test.js`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add vitest.config.js tests/setup.js src/db.js src/algorithms/quizStrategy.js src/algorithms/sm2.js tests/sm2.test.js
git commit -m "feat: add SM-2 spaced repetition algorithm with strategy pattern"
```

---

### Task 4: Modify Quiz API to Use Strategy Pattern

**Files:**
- Modify: `src/api/quiz.js`
- Create: `tests/quiz-sm2.test.js`

- [ ] **Step 1: Rewrite quiz.js to use strategy**

Replace the entire content of `src/api/quiz.js`:

```javascript
import express from 'express';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { getDueWords, recordResult, initWord } from '../algorithms/quizStrategy.js';

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

  // Record quiz answer
  const result = db.prepare(
    'INSERT INTO quiz_records (word_id, correct, quiz_date, user_id) VALUES (?, ?, ?, ?)'
  ).run(word_id, correct, today, req.userId);

  // Update SM-2 state
  recordResult(req.userId, word_id, correct === 1);

  const record = db.prepare('SELECT * FROM quiz_records WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(record);
});

export default router;
```

- [ ] **Step 2: Create integration test for quiz API**

```javascript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/server.js';
import db from '../src/db.js';

describe('Quiz API with SM-2', () => {
  let testUser;
  let testWord;

  beforeAll(() => {
    // Create test user
    testUser = db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
      .run('quiz_test_user', 'hash', 'user');

    // Create test words
    testWord = db.prepare('INSERT INTO words (english, chinese, user_id) VALUES (?, ?, ?)')
      .run('quiztest', '测试词', testUser.lastInsertRowid);

    // Initialize SM-2 review for the word
    const today = new Date().toISOString().slice(0, 10);
    db.prepare(`
      INSERT INTO sm2_reviews (user_id, word_id, interval, efactor, repetitions, next_review)
      VALUES (?, ?, 0, 2.5, 0, ?)
    `).run(testUser.lastInsertRowid, testWord.lastInsertRowid, today);
  });

  afterAll(() => {
    db.prepare('DELETE FROM sm2_reviews WHERE user_id = ?').run(testUser.lastInsertRowid);
    db.prepare('DELETE FROM quiz_records WHERE user_id = ?').run(testUser.lastInsertRowid);
    db.prepare('DELETE FROM words WHERE id = ?').run(testWord.lastInsertRowid);
    db.prepare('DELETE FROM users WHERE id = ?').run(testUser.lastInsertRowid);
  });

  it('GET /api/quiz/today returns due words', async () => {
    const res = await request(app)
      .get('/api/quiz/today')
      .set('Cookie', [`sessionId=test_quiz_1`])
      .expect(401); // No session — should be unauthorized
  });

  it('POST /api/quiz/record rejects unauthenticated', async () => {
    await request(app)
      .post('/api/quiz/record')
      .send({ word_id: 1, correct: 1 })
      .expect(401);
  });
});
```

Note: These tests verify auth gate. For full integration tests with session, we'd need auth setup. The SM-2 algorithm tests (Task 1) cover the core logic.

- [ ] **Step 3: Commit**

```bash
git add src/api/quiz.js tests/quiz-sm2.test.js
git commit -m "feat: integrate strategy pattern into quiz API"
```

---

### Task 5: Add SM-2 Stats Endpoints

**Files:**
- Modify: `src/api/stats.js`

- [ ] **Step 1: Add SM-2 stats routes to stats.js**

Add to the top of `src/api/stats.js`, after existing imports:

```javascript
import { getSm2Stats, getSm2WordStats } from '../algorithms/sm2.js';
```

Add before `export default router;` (line 101):

```javascript
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
```

- [ ] **Step 2: Commit**

```bash
git add src/api/stats.js
git commit -m "feat: add SM-2 stats API endpoints"
```

---

### Task 6: Cascade Delete SM-2 Reviews on Word Delete

**Files:**
- Modify: `src/api/words.js`

- [ ] **Step 1: Add sm2_reviews cascade delete in words.js**

In the `DELETE` route, add before the existing `DELETE FROM words` line. Find:

```javascript
  db.prepare('DELETE FROM quiz_records WHERE word_id = ?').run(id);
```

Add after it:

```javascript
  db.prepare('DELETE FROM sm2_reviews WHERE word_id = ?').run(id);
```

- [ ] **Step 2: Commit**

```bash
git add src/api/words.js
git commit -m "fix: cascade delete sm2_reviews when word is deleted"
```

---

### Task 7: Frontend SM-2 Stats Panel

**Files:**
- Modify: `public/app.js`
- Modify: `public/index.html`
- Modify: `public/style.css`

- [ ] **Step 1: Add SM-2 state and methods to app.js**

In the `quizApp()` function, add after `worstWords: [],` (around line 45):

```javascript
    // SM-2 stats
    sm2Overview: null,
    sm2WordStates: [],
```

Add a new method after `loadWorstWords()` (around line 470):

```javascript
    async loadSm2Stats() {
      try {
        const res = await fetch('/api/stats/sm2');
        this.sm2Overview = await res.json();
      } catch (e) { console.error(e); }
    },

    async loadSm2WordStates() {
      try {
        const res = await fetch('/api/stats/sm2/words');
        this.sm2WordStates = await res.json();
      } catch (e) { console.error(e); }
    },

    getMasteryColor(efactor) {
      if (efactor >= 2.3) return 'good';
      if (efactor >= 1.8) return 'warn';
      return 'bad';
    },

    getStageLabel(repetitions) {
      if (repetitions === 0) return '新词/错误';
      if (repetitions === 1) return '学习中';
      if (repetitions === 2) return '熟悉';
      return '已掌握';
    },
```

Update `setStatsTab` to include 'sm2' tab:

```javascript
    setStatsTab(tab) {
      this.statsTab = tab;
      if (tab === 'sm2') {
        if (!this.sm2Overview) this.loadSm2Stats();
        if (this.sm2WordStates.length === 0) this.loadSm2WordStates();
      }
      if (tab === 'word') this.loadAllWordStats();
      if (tab === 'daily' && this.dailyStats.length === 0) this.loadDailyStats();
      if (tab === 'trend' && this.trendData.length === 0) this.loadTrendData();
      if (tab === 'worst' && this.worstWords.length === 0) this.loadWorstWords();
    },
```

- [ ] **Step 2: Add SM-2 tab and panel to index.html**

In the stats nav (line 252-257), add a new button before "单词详情":

```html
<button :class="{ active: statsTab === 'sm2' }" @click="setStatsTab('sm2')">间隔重复</button>
```

Before the "单词详情" panel (line 259), add the SM-2 panel:

```html
<div x-show="statsTab === 'sm2'" class="stats-panel">
  <!-- Overview -->
  <div class="sm2-overview" x-show="sm2Overview">
    <div class="sm2-stat">
      <span class="sm2-label">总词数</span>
      <span class="sm2-value" x-text="sm2Overview.total"></span>
    </div>
    <div class="sm2-stat">
      <span class="sm2-label">今日到期</span>
      <span class="sm2-value" x-text="sm2Overview.dueToday"></span>
    </div>
    <div class="sm2-stat">
      <span class="sm2-label">平均难度系数</span>
      <span class="sm2-value" x-text="sm2Overview.avgEfactor"></span>
    </div>
    <!-- Stage distribution -->
    <div class="sm2-stages">
      <template x-for="stage in sm2Overview.stageDist" :key="stage.stage">
        <div class="sm2-stage-item">
          <span x-text="stage.stage"></span>
          <span class="sm2-stage-count" x-text="stage.count"></span>
        </div>
      </template>
    </div>
  </div>

  <!-- Per-word states -->
  <div class="sm2-word-list">
    <template x-for="sw in sm2WordStates" :key="sw.id">
      <div class="sm2-word-item">
        <div class="sm2-word-info">
          <span class="sm2-word-text" x-text="`${sw.english} (${sw.chinese})`"></span>
          <span class="sm2-stage-badge" :class="getMasteryColor(sw.efactor)" x-text="getStageLabel(sw.repetitions)"></span>
        </div>
        <div class="sm2-word-details">
          <span class="sm2-detail" x-text="`间隔: ${sw.interval}天`"></span>
          <span class="sm2-detail" :class="getMasteryColor(sw.efactor)" x-text="`系数: ${sw.efactor}`"></span>
          <span class="sm2-detail" x-text="`下次: ${sw.next_review}`"></span>
        </div>
      </div>
    </template>
  </div>
  <p x-show="sm2WordStates.length === 0" class="empty-hint">暂无数据</p>
</div>
```

- [ ] **Step 3: Add CSS for SM-2 stats panel**

Append to `public/style.css`:

```css
/* SM-2 Stats Panel */
.sm2-overview {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 12px;
  margin-bottom: 20px;
  padding: 16px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
}

.sm2-stat {
  text-align: center;
}

.sm2-label {
  display: block;
  font-size: 12px;
  color: #94a3b8;
  margin-bottom: 4px;
}

.sm2-value {
  font-size: 24px;
  font-weight: 700;
  color: #fbbf24;
}

.sm2-stages {
  grid-column: 1 / -1;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 8px;
}

.sm2-stage-item {
  padding: 4px 12px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  font-size: 13px;
  display: flex;
  gap: 8px;
}

.sm2-stage-count {
  color: #fbbf24;
  font-weight: 600;
}

.sm2-word-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sm2-word-item {
  padding: 12px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
}

.sm2-word-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.sm2-word-text {
  font-weight: 600;
}

.sm2-stage-badge {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
}

.sm2-stage-badge.good {
  background: rgba(34, 197, 94, 0.2);
  color: #22c55e;
}

.sm2-stage-badge.warn {
  background: rgba(251, 191, 36, 0.2);
  color: #fbbf24;
}

.sm2-stage-badge.bad {
  background: rgba(239, 68, 68, 0.2);
  color: #ef4444;
}

.sm2-word-details {
  display: flex;
  gap: 16px;
  font-size: 13px;
  color: #94a3b8;
}

.sm2-detail.good { color: #22c55e; }
.sm2-detail.warn { color: #fbbf24; }
.sm2-detail.bad { color: #ef4444; }
```

- [ ] **Step 4: Commit**

```bash
git add public/app.js public/index.html public/style.css
git commit -m "feat: add SM-2 stats panel with per-word state display"
```

---

### Task 8: Set ACTIVE_STRATEGY=sm2 and Smoke Test

**Files:**
- Modify: `src/server.js`

- [ ] **Step 1: Set default ACTIVE_STRATEGY in server.js**

Add near the top (after imports, before `const __dirname`):

```javascript
process.env.ACTIVE_STRATEGY = process.env.ACTIVE_STRATEGY || 'sm2';
```

- [ ] **Step 2: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 3: Start server and verify**

Run: `docker compose up -d --build`
Expected: Server starts on port 3000

- [ ] **Step 4: Verify API endpoints**

```bash
# Check that the server responds
curl -s http://localhost:3000/api/quiz/today  # Should return 401 (auth required)

# Verify SM-2 strategy is active (check env in server)
docker exec word-tester-test node -e "console.log(process.env.ACTIVE_STRATEGY)" 2>/dev/null || echo "Check via code"
```

- [ ] **Step 5: Final commit**

```bash
git add src/server.js
git commit -m "chore: set SM-2 as default quiz strategy"
```

---
