# Word Quiz Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Docker-deployed children's word spelling quiz app with starry-sky themed UI, SQLite storage, and statistics tracking.

**Architecture:** Single-page Alpine.js frontend served by Express.js backend, which reads/writes to a SQLite database. All in one Docker container with volume persistence.

**Tech Stack:** Node.js 20, Express.js, better-sqlite3, Alpine.js (CDN), Docker

---

### File Map

| File | Responsibility |
|------|---------------|
| `package.json` | Project deps and scripts |
| `src/db.js` | SQLite initialization, schema creation, db helper |
| `src/server.js` | Express app setup, static serving, route mounting, error handling |
| `src/api/words.js` | Word CRUD endpoints |
| `src/api/quiz.js` | Quiz generation and answer recording |
| `src/api/stats.js` | Statistics aggregation endpoints |
| `public/index.html` | Main SPA shell with Alpine.js CDN |
| `public/app.js` | Alpine.js application state and logic |
| `public/style.css` | Starry theme styles and animations |
| `Dockerfile` | Docker image definition |
| `docker-compose.yml` | Docker compose with volume |
| `test/words.test.js` | Word CRUD tests |
| `test/quiz.test.js` | Quiz algorithm tests |
| `test/stats.test.js` | Stats aggregation tests |

---

### Task 1: Project Skeleton, Database, and Server Bootstrap

**Files:**
- Create: `package.json`
- Create: `src/db.js`
- Create: `src/server.js`
- Create: `test/db.test.js`

- [ ] **Step 1: Install dependencies and create package.json**

```bash
cd /home/ubuntu/codes/word-tester
npm init -y
npm install express better-sqlite3
npm install --save-dev vitest supertest
```

Edit `package.json` to add scripts:

```json
{
  "name": "word-quiz",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "start": "node src/server.js",
    "dev": "node --watch src/server.js",
    "test": "vitest run"
  }
}
```

- [ ] **Step 2: Create database module**

Create `src/db.js`:

```javascript
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const dbDir = process.env.DB_DIR || path.join(process.cwd(), 'data');
const dbPath = path.join(dbDir, 'words.db');

fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(dbPath);

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Schema migration
db.exec(`
  CREATE TABLE IF NOT EXISTS words (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    english TEXT NOT NULL UNIQUE,
    chinese TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (date('now'))
  );

  CREATE TABLE IF NOT EXISTS quiz_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    word_id INTEGER NOT NULL REFERENCES words(id),
    correct INTEGER NOT NULL CHECK(correct IN (0, 1)),
    quiz_date TEXT NOT NULL DEFAULT (date('now'))
  );
`);

export default db;
```

- [ ] **Step 3: Create server module**

Create `src/server.js`:

```javascript
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import wordsRouter from './api/words.js';
import quizRouter from './api/quiz.js';
import statsRouter from './api/stats.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// API routes
app.use('/api/words', wordsRouter);
app.use('/api/quiz', quizRouter);
app.use('/api/stats', statsRouter);

// SPA fallback — serve index.html for all non-API routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Word Quiz server running on port ${PORT}`);
});
```

- [ ] **Step 4: Write database test**

Create `test/db.test.js`:

```javascript
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';

const testDbDir = path.join(process.cwd(), 'data-test');
process.env.DB_DIR = testDbDir;

// Import db module after setting env
const { default: db } = await import('../src/db.js');

describe('Database', () => {
  it('should have words table', () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    const tableNames = tables.map(t => t.name);
    expect(tableNames).toContain('words');
    expect(tableNames).toContain('quiz_records');
  });

  it('should insert and query a word', () => {
    const result = db.prepare("INSERT INTO words (english, chinese, created_at) VALUES (?, ?, ?)")
      .run('test', '测试', '2026-05-09');
    expect(result.changes).toBe(1);

    const row = db.prepare('SELECT * FROM words WHERE english = ?').get('test');
    expect(row.english).toBe('test');
    expect(row.chinese).toBe('测试');
  });
});

afterAll(() => {
  db.close();
  fs.rmSync(testDbDir, { recursive: true, force: true });
});
```

- [ ] **Step 5: Run test**

```bash
cd /home/ubuntu/codes/word-tester
DB_DIR=./data-test npx vitest run test/db.test.js
```

Expected: 2 passing tests.

- [ ] **Step 6: Initialize git and commit**

```bash
cd /home/ubuntu/codes/word-tester
git init
echo "node_modules/" > .gitignore
echo "data/" >> .gitignore
echo "data-test/" >> .gitignore
git add .
git commit -m "feat: project skeleton with SQLite database and Express server"
```

---

### Task 2: Word CRUD API

**Files:**
- Create: `src/api/words.js`
- Create: `test/words.test.js`

- [ ] **Step 1: Write word CRUD tests**

Create `test/words.test.js`:

```javascript
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testDbDir = path.join(process.cwd(), 'data-test-words');
process.env.DB_DIR = testDbDir;

const { default: db } = await import('../src/db.js');
const app = (await import('../src/server.js')).default;
import request from 'supertest';

// Create a test app that doesn't listen
import express from 'express';
import wordsRouter from '../src/api/words.js';

const testApp = express();
testApp.use(express.json());
testApp.use('/api/words', wordsRouter);

describe('Words API', () => {
  beforeEach(() => {
    db.exec('DELETE FROM quiz_records');
    db.exec('DELETE FROM words');
    db.exec("DELETE FROM sqlite_sequence WHERE name='words'");
  });

  afterAll(() => {
    db.close();
    fs.rmSync(testDbDir, { recursive: true, force: true });
  });

  describe('POST /api/words', () => {
    it('should create a word', async () => {
      const res = await request(testApp)
        .post('/api/words')
        .send({ english: 'apple', chinese: '苹果' });

      expect(res.status).toBe(201);
      expect(res.body.english).toBe('apple');
      expect(res.body.chinese).toBe('苹果');
      expect(res.body.id).toBeDefined();
    });

    it('should return 409 for duplicate word', async () => {
      await request(testApp).post('/api/words').send({ english: 'apple', chinese: '苹果' });
      const res = await request(testApp)
        .post('/api/words')
        .send({ english: 'apple', chinese: '苹果' });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('该单词已存在');
    });

    it('should return 400 for missing fields', async () => {
      const res = await request(testApp).post('/api/words').send({ english: 'apple' });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/words', () => {
    it('should return all words', async () => {
      db.prepare("INSERT INTO words (english, chinese, created_at) VALUES (?, ?, ?)").run('cat', '猫', '2026-05-09');
      db.prepare("INSERT INTO words (english, chinese, created_at) VALUES (?, ?, ?)").run('dog', '狗', '2026-05-09');

      const res = await request(testApp).get('/api/words');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
    });

    it('should return empty array when no words', async () => {
      const res = await request(testApp).get('/api/words');
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  describe('PUT /api/words/:id', () => {
    it('should update a word', async () => {
      const insert = db.prepare("INSERT INTO words (english, chinese, created_at) VALUES (?, ?, ?)").run('cat', '猫', '2026-05-09');
      const res = await request(testApp)
        .put(`/api/words/${insert.lastInsertRowid}`)
        .send({ english: 'kitten', chinese: '小猫' });

      expect(res.status).toBe(200);
      expect(res.body.english).toBe('kitten');
      expect(res.body.chinese).toBe('小猫');
    });

    it('should return 404 for non-existent word', async () => {
      const res = await request(testApp)
        .put('/api/words/999')
        .send({ english: 'x', chinese: 'x' });
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/words/:id', () => {
    it('should delete a word', async () => {
      const insert = db.prepare("INSERT INTO words (english, chinese, created_at) VALUES (?, ?, ?)").run('cat', '猫', '2026-05-09');
      const res = await request(testApp).delete(`/api/words/${insert.lastInsertRowid}`);
      expect(res.status).toBe(200);

      const row = db.prepare('SELECT * FROM words WHERE id = ?').get(insert.lastInsertRowid);
      expect(row).toBeUndefined();
    });

    it('should return 404 for non-existent word', async () => {
      const res = await request(testApp).delete('/api/words/999');
      expect(res.status).toBe(404);
    });
  });
});
```

- [ ] **Step 2: Implement word CRUD API**

Create `src/api/words.js`:

```javascript
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
```

- [ ] **Step 3: Run tests**

```bash
cd /home/ubuntu/codes/word-tester
DB_DIR=./data-test-words npx vitest run test/words.test.js
```

Expected: All tests passing.

- [ ] **Step 4: Commit**

```bash
git add src/api/words.js test/words.test.js
git commit -m "feat: word CRUD API with tests"
```

---

### Task 3: Quiz API — Generation and Recording

**Files:**
- Create: `src/api/quiz.js`
- Create: `test/quiz.test.js`

- [ ] **Step 1: Write quiz tests**

Create `test/quiz.test.js`:

```javascript
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import express from 'express';

const testDbDir = path.join(process.cwd(), 'data-test-quiz');
process.env.DB_DIR = testDbDir;

const { default: db } = await import('../src/db.js');
import quizRouter from '../src/api/quiz.js';
import request from 'supertest';

const testApp = express();
testApp.use(express.json());
testApp.use('/api/quiz', quizRouter);

function addWord(english, chinese, date) {
  return db.prepare('INSERT INTO words (english, chinese, created_at) VALUES (?, ?, ?)')
    .run(english, chinese, date || '2026-05-09');
}

describe('Quiz API', () => {
  beforeEach(() => {
    db.exec('DELETE FROM quiz_records');
    db.exec('DELETE FROM words');
    db.exec("DELETE FROM sqlite_sequence WHERE name='words'");
  });

  afterAll(() => {
    db.close();
    fs.rmSync(testDbDir, { recursive: true, force: true });
  });

  describe('GET /api/quiz/today', () => {
    it('should return empty list when no words', async () => {
      const res = await request(testApp).get('/api/quiz/today');
      expect(res.status).toBe(200);
      expect(res.body.words).toEqual([]);
    });

    it('should always include new words added today', async () => {
      const today = new Date().toISOString().slice(0, 10);
      addWord('new1', '新词1', today);
      addWord('new2', '新词2', today);
      addWord('old1', '旧词1', '2026-01-01');
      addWord('old2', '旧词2', '2026-01-01');
      addWord('old3', '旧词3', '2026-01-01');

      const res = await request(testApp).get('/api/quiz/today');
      expect(res.status).toBe(200);
      const englishList = res.body.words.map(w => w.english);
      expect(englishList).toContain('new1');
      expect(englishList).toContain('new2');
    });

    it('should select approximately 15% of old words', async () => {
      const today = new Date().toISOString().slice(0, 10);
      addWord('new1', '新词1', today);
      // Add 20 old words — 15% = 3
      for (let i = 1; i <= 20; i++) {
        addWord(`old${i}`, `旧词${i}`, '2026-01-01');
      }

      const res = await request(testApp).get('/api/quiz/today');
      expect(res.status).toBe(200);
      // Should have 1 new + 3 old = 4 (ceil(20 * 0.15) = 3)
      expect(res.body.words.length).toBe(4);
      const englishList = res.body.words.map(w => w.english);
      expect(englishList).toContain('new1');
    });

    it('should shuffle the result', async () => {
      const today = new Date().toISOString().slice(0, 10);
      for (let i = 1; i <= 10; i++) {
        addWord(`word${i}`, `词${i}`, today);
      }

      // Run multiple times and check order varies
      const results = new Set();
      for (let i = 0; i < 5; i++) {
        const res = await request(testApp).get('/api/quiz/today');
        const order = res.body.words.map(w => w.english).join(',');
        results.add(order);
      }
      // With 10 items, shuffling should produce different orders
      expect(results.size).toBeGreaterThan(1);
    });
  });

  describe('POST /api/quiz/record', () => {
    it('should record a correct answer', async () => {
      const word = addWord('apple', '苹果');
      const res = await request(testApp)
        .post('/api/quiz/record')
        .send({ word_id: word.lastInsertRowid, correct: 1 });

      expect(res.status).toBe(201);
      const record = db.prepare('SELECT * FROM quiz_records WHERE word_id = ?').get(word.lastInsertRowid);
      expect(record.correct).toBe(1);
    });

    it('should record an incorrect answer', async () => {
      const word = addWord('apple', '苹果');
      const res = await request(testApp)
        .post('/api/quiz/record')
        .send({ word_id: word.lastInsertRowid, correct: 0 });

      expect(res.status).toBe(201);
      const record = db.prepare('SELECT * FROM quiz_records WHERE word_id = ?').get(word.lastInsertRowid);
      expect(record.correct).toBe(0);
    });

    it('should return 400 for missing fields', async () => {
      const res = await request(testApp).post('/api/quiz/record').send({ word_id: 1 });
      expect(res.status).toBe(400);
    });
  });
});
```

- [ ] **Step 2: Implement quiz API**

Create `src/api/quiz.js`:

```javascript
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
```

- [ ] **Step 3: Run tests**

```bash
cd /home/ubuntu/codes/word-tester
DB_DIR=./data-test-quiz npx vitest run test/quiz.test.js
```

Expected: All tests passing.

- [ ] **Step 4: Commit**

```bash
git add src/api/quiz.js test/quiz.test.js
git commit -m "feat: quiz generation and answer recording API with tests"
```

---

### Task 4: Statistics API

**Files:**
- Create: `src/api/stats.js`
- Create: `test/stats.test.js`

- [ ] **Step 1: Write stats tests**

Create `test/stats.test.js`:

```javascript
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import express from 'express';

const testDbDir = path.join(process.cwd(), 'data-test-stats');
process.env.DB_DIR = testDbDir;

const { default: db } = await import('../src/db.js');
import statsRouter from '../src/api/stats.js';
import request from 'supertest';

const testApp = express();
testApp.use(express.json());
testApp.use('/api/stats', statsRouter);

function addWord(english, chinese, date) {
  return db.prepare('INSERT INTO words (english, chinese, created_at) VALUES (?, ?, ?)')
    .run(english, chinese, date || '2026-05-01');
}

function addRecord(wordId, correct, date) {
  return db.prepare('INSERT INTO quiz_records (word_id, correct, quiz_date) VALUES (?, ?, ?)')
    .run(wordId, correct, date || '2026-05-01');
}

describe('Stats API', () => {
  beforeEach(() => {
    db.exec('DELETE FROM quiz_records');
    db.exec('DELETE FROM words');
    db.exec("DELETE FROM sqlite_sequence WHERE name='words'");
  });

  afterAll(() => {
    db.close();
    fs.rmSync(testDbDir, { recursive: true, force: true });
  });

  describe('GET /api/stats/word/:id', () => {
    it('should return per-word accuracy', async () => {
      const word = addWord('apple', '苹果');
      addRecord(word.lastInsertRowid, 1, '2026-05-01');
      addRecord(word.lastInsertRowid, 1, '2026-05-02');
      addRecord(word.lastInsertRowid, 0, '2026-05-03');

      const res = await request(testApp).get(`/api/stats/word/${word.lastInsertRowid}`);
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(3);
      expect(res.body.correct).toBe(2);
      expect(res.body.accuracy).toBeCloseTo(0.667, 2);
    });

    it('should return zeros for word with no records', async () => {
      const word = addWord('new', '新的');
      const res = await request(testApp).get(`/api/stats/word/${word.lastInsertRowid}`);
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(0);
      expect(res.body.accuracy).toBe(0);
    });
  });

  describe('GET /api/stats/daily', () => {
    it('should return daily report', async () => {
      const w1 = addWord('apple', '苹果');
      const w2 = addWord('banana', '香蕉');
      addRecord(w1.lastInsertRowid, 1, '2026-05-01');
      addRecord(w2.lastInsertRowid, 0, '2026-05-01');
      addRecord(w1.lastInsertRowid, 1, '2026-05-02');

      const res = await request(testApp).get('/api/stats/daily');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);

      const may01 = res.body.find(d => d.date === '2026-05-01');
      expect(may01.total).toBe(2);
      expect(may01.correct).toBe(1);
      expect(may01.accuracy).toBe(0.5);
    });
  });

  describe('GET /api/stats/trend', () => {
    it('should return weekly trend', async () => {
      const w = addWord('apple', '苹果');
      addRecord(w.lastInsertRowid, 1, '2026-04-28');
      addRecord(w.lastInsertRowid, 0, '2026-04-29');
      addRecord(w.lastInsertRowid, 1, '2026-05-01');
      addRecord(w.lastInsertRowid, 1, '2026-05-05');

      const res = await request(testApp).get('/api/stats/trend?period=week');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      // Each item should have week label and accuracy
      expect(res.body[0]).toHaveProperty('label');
      expect(res.body[0]).toHaveProperty('accuracy');
    });
  });

  describe('GET /api/stats/worst', () => {
    it('should return worst words sorted by accuracy', async () => {
      const w1 = addWord('perfect', '完美');
      const w2 = addWord('hard', '困难');
      const w3 = addWord('medium', '中等');
      addRecord(w1.lastInsertRowid, 1, '2026-05-01');
      addRecord(w1.lastInsertRowid, 1, '2026-05-02');
      addRecord(w2.lastInsertRowid, 0, '2026-05-01');
      addRecord(w2.lastInsertRowid, 0, '2026-05-02');
      addRecord(w3.lastInsertRowid, 1, '2026-05-01');
      addRecord(w3.lastInsertRowid, 0, '2026-05-02');

      const res = await request(testApp).get('/api/stats/worst?limit=3');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(3);
      expect(res.body[0].english).toBe('hard'); // 0% accuracy
      expect(res.body[1].english).toBe('medium'); // 50% accuracy
      expect(res.body[2].english).toBe('perfect'); // 100% accuracy
    });

    it('should default limit to 10', async () => {
      for (let i = 0; i < 15; i++) {
        const w = addWord(`word${i}`, `词${i}`);
        addRecord(w.lastInsertRowid, 0, '2026-05-01');
      }

      const res = await request(testApp).get('/api/stats/worst');
      expect(res.status).toBe(200);
      expect(res.body.length).toBeLessThanOrEqual(10);
    });
  });
});
```

- [ ] **Step 2: Implement stats API**

Create `src/api/stats.js`:

```javascript
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
```

- [ ] **Step 3: Run tests**

```bash
cd /home/ubuntu/codes/word-tester
DB_DIR=./data-test-stats npx vitest run test/stats.test.js
```

Expected: All tests passing.

- [ ] **Step 4: Commit**

```bash
git add src/api/stats.js test/stats.test.js
git commit -m "feat: statistics API with per-word, daily, trend, and worst-word stats"
```

---

### Task 5: Frontend — SPA Shell and Quiz Flow

**Files:**
- Create: `public/index.html`
- Create: `public/app.js`
- Create: `public/style.css`

- [ ] **Step 1: Create the HTML shell**

Create `public/index.html`:

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>⭐ 单词抽查</title>
  <link rel="stylesheet" href="style.css">
  <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js"></script>
  <script defer src="app.js"></script>
</head>
<body x-data="quizApp()" x-init="init()">

  <!-- Stars container -->
  <div class="stars" id="stars"></div>

  <!-- Main Quiz View -->
  <div class="app" x-show="view === 'quiz'">
    <header>
      <h1>⭐ 单词抽查</h1>
      <span class="progress" x-show="quizWords.length > 0" x-text="`进度 ${currentIndex + 1}/${quizWords.length}`"></span>
      <button class="admin-toggle" @click="showAdmin = true">⚙</button>
    </header>

    <!-- Empty state -->
    <div class="empty-state" x-show="quizWords.length === 0 && !loading">
      <p>还没有单词哦！</p>
      <p class="hint">点击左上角 ⚙ 添加单词吧 →</p>
    </div>

    <!-- Loading -->
    <div class="loading" x-show="loading">
      <div class="spinner"></div>
      <p>准备中...</p>
    </div>

    <!-- Quiz card -->
    <div class="quiz-card" x-show="quizWords.length > 0 && currentWord && !loading">
      <!-- Phase 1: Show Chinese, hide answer -->
      <div x-show="!revealed">
        <p class="chinese" x-text="currentWord.chinese"></p>
        <button class="btn-reveal" @click="reveal()">🔍 点击显示答案</button>
      </div>

      <!-- Phase 2: Show English answer -->
      <div x-show="revealed && !answered">
        <p class="english" :class="{ 'incorrect': markWrong }" x-text="currentWord.english"></p>
        <div class="action-buttons">
          <button class="btn-correct" @click="markCorrect()">👍 答对了 +1</button>
          <button class="btn-wrong" @click="markIncorrect()">💪 再想想</button>
        </div>
      </div>

      <!-- Phase 3: Answer recorded, show next button -->
      <div x-show="answered" class="feedback">
        <div x-show="isCorrect" class="celebration">
          <div class="thumbs-up">👍</div>
          <p class="great-text">Great!</p>
        </div>
        <div x-show="!isCorrect" class="encouragement">
          <p>加油！再记一遍 💪</p>
        </div>
        <button class="btn-next" x-show="currentIndex < quizWords.length - 1" @click="nextWord()">下一个 →</button>
        <div x-show="currentIndex >= quizWords.length - 1" class="complete">
          <p>🎉 今天的抽查完成啦！</p>
          <button class="btn-next" @click="startQuiz()">再考一次</button>
        </div>
      </div>
    </div>
  </div>

  <!-- Admin Drawer -->
  <div class="drawer-overlay" x-show="showAdmin" @click.self="showAdmin = false" x-transition.opacity></div>
  <div class="drawer" x-show="showAdmin" x-transition:enter="drawer-enter" x-transition:leave="drawer-leave">
    <header class="drawer-header">
      <h2>📝 管理</h2>
      <button class="close-btn" @click="showAdmin = false">✕</button>
    </header>

    <!-- Admin Tabs -->
    <nav class="admin-tabs">
      <button :class="{ active: adminTab === 'add' }" @click="adminTab = 'add'">添加</button>
      <button :class="{ active: adminTab === 'list' }" @click="adminTab = 'list'">词库</button>
      <button :class="{ active: adminTab === 'stats' }" @click="adminTab = 'stats'">统计</button>
    </nav>

    <!-- Add Word Tab -->
    <div x-show="adminTab === 'add'" class="tab-content">
      <div class="add-form">
        <input type="text" x-model="newEnglish" placeholder="英文单词" @keydown.enter="addWord()">
        <input type="text" x-model="newChinese" placeholder="中文意思" @keydown.enter="addWord()">
        <button class="btn-save" @click="addWord()" :disabled="!newEnglish || !newChinese">保存</button>
        <p class="save-msg" x-show="saveMsg" x-text="saveMsg"></p>
      </div>
    </div>

    <!-- Word List Tab -->
    <div x-show="adminTab === 'list'" class="tab-content">
      <input type="text" x-model="searchQuery" placeholder="🔍 搜索单词..." class="search-input">
      <div class="word-list">
        <template x-for="word in filteredWords" :key="word.id">
          <div class="word-item">
            <div class="word-info">
              <span class="word-en" x-text="word.english"></span>
              <span class="word-zh" x-text="word.chinese"></span>
            </div>
            <div class="word-actions">
              <button class="btn-sm btn-edit" @click="editWord(word)">编辑</button>
              <button class="btn-sm btn-del" @click="deleteWord(word.id)">删除</button>
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- Stats Tab -->
    <div x-show="adminTab === 'stats'" class="tab-content">
      <nav class="stats-tabs">
        <button :class="{ active: statsTab === 'word' }" @click="statsTab = 'word'">单词详情</button>
        <button :class="{ active: statsTab === 'daily' }" @click="statsTab = 'daily'">每日报告</button>
        <button :class="{ active: statsTab === 'trend' }" @click="statsTab = 'trend'">趋势</button>
        <button :class="{ active: statsTab === 'worst' }" @click="statsTab = 'worst'">错词排行</button>
      </nav>

      <!-- Per-word stats -->
      <div x-show="statsTab === 'word'" class="stats-panel">
        <button class="btn-sm btn-load" @click="loadAllWordStats()">加载全部</button>
        <div class="word-stats-list">
          <template x-for="ws in wordStats" :key="ws.id">
            <div class="word-stat-item">
              <span class="ws-word" x-text="`${ws.english} (${ws.chinese})`"></span>
              <span class="ws-accuracy" :class="ws.accuracy >= 0.8 ? 'good' : ws.accuracy >= 0.5 ? 'warn' : 'bad'"
                    x-text="ws.total > 0 ? `${Math.round(ws.accuracy * 100)}% (${ws.correct}/${ws.total})` : '未考过'">
              </span>
            </div>
          </template>
        </div>
      </div>

      <!-- Daily report -->
      <div x-show="statsTab === 'daily'" class="stats-panel">
        <template x-for="d in dailyStats" :key="d.date">
          <div class="daily-item">
            <span class="d-date" x-text="d.date"></span>
            <span class="d-count" x-text="`共 ${d.total} 题`"></span>
            <span class="d-accuracy" x-text="`正确率 ${Math.round(d.accuracy * 100)}%`"></span>
          </div>
        </template>
        <p x-show="dailyStats.length === 0" class="empty-hint">暂无数据</p>
      </div>

      <!-- Trend chart -->
      <div x-show="statsTab === 'trend'" class="stats-panel">
        <div class="trend-chart">
          <template x-for="t in trendData" :key="t.label">
            <div class="trend-bar">
              <span class="trend-label" x-text="t.label"></span>
              <div class="trend-fill">
                <div class="trend-fill-inner" :style="`width: ${t.accuracy * 100}%`"></div>
              </div>
              <span class="trend-value" x-text="`${Math.round(t.accuracy * 100)}%`"></span>
            </div>
          </template>
        </div>
        <p x-show="trendData.length === 0" class="empty-hint">暂无数据</p>
      </div>

      <!-- Wrong word ranking -->
      <div x-show="statsTab === 'worst'" class="stats-panel">
        <template x-for="(w, i) in worstWords" :key="w.id">
          <div class="worst-item">
            <span class="worst-rank" x-text="`${i + 1}`"></span>
            <span class="worst-word" x-text="`${w.english} (${w.chinese})`"></span>
            <span class="worst-accuracy" :class="w.accuracy >= 0.5 ? 'warn' : 'bad'"
                  x-text="`${Math.round(w.accuracy * 100)}%`"></span>
          </div>
        </template>
        <p x-show="worstWords.length === 0" class="empty-hint">暂无数据</p>
      </div>
    </div>

    <!-- Edit modal within admin -->
    <div class="edit-modal" x-show="editingWord">
      <div class="edit-form">
        <h3>编辑单词</h3>
        <input type="text" x-model="editEnglish" placeholder="英文">
        <input type="text" x-model="editChinese" placeholder="中文">
        <div class="edit-actions">
          <button class="btn-save" @click="saveEdit()">保存</button>
          <button class="btn-cancel" @click="editingWord = null">取消</button>
        </div>
      </div>
    </div>
  </div>

</body>
</html>
```

- [ ] **Step 2: Create CSS styles**

Create `public/style.css`:

```css
/* Reset and base */
* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
  background: linear-gradient(135deg, #0a0a2e 0%, #16213e 50%, #1a1a4e 100%);
  color: #e2e8f0;
  min-height: 100vh;
  overflow-x: hidden;
}

/* Stars background */
.stars {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  pointer-events: none;
  z-index: 0;
}

.star {
  position: absolute;
  width: 3px;
  height: 3px;
  background: white;
  border-radius: 50%;
  animation: twinkle 2s ease-in-out infinite;
}

@keyframes twinkle {
  0%, 100% { opacity: 0.3; }
  50% { opacity: 1; }
}

/* Falling stars animation */
@keyframes fall {
  0% { transform: translateY(-20px) rotate(0deg); opacity: 1; }
  100% { transform: translateY(100vh) rotate(360deg); opacity: 0; }
}

/* App container */
.app {
  position: relative;
  z-index: 1;
  max-width: 900px;
  margin: 0 auto;
  padding: 16px;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

/* Header */
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 0;
}

header h1 {
  font-size: 24px;
  color: #c4b5fd;
}

.progress {
  font-size: 16px;
  color: #94a3b8;
  background: rgba(124, 58, 237, 0.2);
  padding: 6px 14px;
  border-radius: 20px;
}

.admin-toggle {
  background: rgba(255, 255, 255, 0.1);
  border: none;
  color: #94a3b8;
  font-size: 20px;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  cursor: pointer;
}

/* Quiz card */
.quiz-card {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
}

.chinese {
  font-size: 36px;
  font-weight: bold;
  color: #e2e8f0;
  text-align: center;
  margin-bottom: 30px;
}

.english {
  font-size: 48px;
  font-weight: bold;
  color: #fbbf24;
  text-align: center;
  text-shadow: 0 0 20px rgba(251, 191, 36, 0.5);
  animation: glow 1.5s ease-in-out infinite alternate;
  margin-bottom: 30px;
}

.english.incorrect {
  color: #ef4444;
  text-shadow: 0 0 20px rgba(239, 68, 68, 0.5);
  animation: shake 0.5s ease-in-out;
}

@keyframes glow {
  from { text-shadow: 0 0 10px rgba(251, 191, 36, 0.3); }
  to { text-shadow: 0 0 30px rgba(251, 191, 36, 0.8), 0 0 60px rgba(251, 191, 36, 0.3); }
}

@keyframes shake {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-10px); }
  75% { transform: translateX(10px); }
}

/* Buttons */
.btn-reveal {
  background: linear-gradient(135deg, #7c3aed, #6d28d9);
  color: white;
  border: none;
  padding: 16px 40px;
  border-radius: 30px;
  font-size: 20px;
  cursor: pointer;
  box-shadow: 0 4px 20px rgba(124, 58, 237, 0.4);
  transition: transform 0.2s;
}

.btn-reveal:hover { transform: scale(1.05); }

.action-buttons {
  display: flex;
  gap: 16px;
  margin-top: 10px;
}

.btn-correct {
  background: linear-gradient(135deg, #22c55e, #16a34a);
  color: white;
  border: none;
  padding: 14px 32px;
  border-radius: 25px;
  font-size: 18px;
  cursor: pointer;
  box-shadow: 0 4px 15px rgba(34, 197, 94, 0.3);
  transition: transform 0.2s;
}

.btn-correct:hover { transform: scale(1.05); }

.btn-wrong {
  background: linear-gradient(135deg, #3b82f6, #2563eb);
  color: white;
  border: none;
  padding: 14px 32px;
  border-radius: 25px;
  font-size: 18px;
  cursor: pointer;
  box-shadow: 0 4px 15px rgba(59, 130, 246, 0.3);
  transition: transform 0.2s;
}

.btn-wrong:hover { transform: scale(1.05); }

.btn-next {
  background: linear-gradient(135deg, #7c3aed, #6d28d9);
  color: white;
  border: none;
  padding: 14px 40px;
  border-radius: 25px;
  font-size: 18px;
  cursor: pointer;
  box-shadow: 0 4px 15px rgba(124, 58, 237, 0.4);
  margin-top: 20px;
  transition: transform 0.2s;
}

.btn-next:hover { transform: scale(1.05); }

/* Celebration */
.celebration {
  text-align: center;
  animation: scaleIn 0.3s ease-out;
}

.thumbs-up {
  font-size: 80px;
  animation: bounce 0.6s ease-out;
}

.great-text {
  font-size: 32px;
  color: #fbbf24;
  font-weight: bold;
  margin-top: 10px;
}

@keyframes scaleIn {
  from { transform: scale(0); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}

@keyframes bounce {
  0% { transform: scale(0); }
  50% { transform: scale(1.3); }
  100% { transform: scale(1); }
}

.encouragement {
  text-align: center;
  font-size: 24px;
  color: #f87171;
  animation: scaleIn 0.3s ease-out;
}

.complete {
  text-align: center;
  margin-top: 20px;
}

.complete p {
  font-size: 28px;
  color: #fbbf24;
  margin-bottom: 16px;
}

/* Empty state */
.empty-state {
  text-align: center;
  padding: 60px 20px;
}

.empty-state p {
  font-size: 24px;
  color: #94a3b8;
  margin-bottom: 10px;
}

.empty-state .hint {
  font-size: 18px;
  color: #64748b;
}

/* Loading */
.loading {
  text-align: center;
  padding: 60px 20px;
}

.spinner {
  width: 40px;
  height: 40px;
  border: 4px solid rgba(124, 58, 237, 0.3);
  border-top-color: #7c3aed;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin: 0 auto 16px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* Drawer */
.drawer-overlay {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 100;
}

.drawer {
  position: fixed;
  top: 0; right: 0; bottom: 0;
  width: min(420px, 90vw);
  background: #1e1e3f;
  z-index: 101;
  display: flex;
  flex-direction: column;
  box-shadow: -4px 0 20px rgba(0, 0, 0, 0.5);
  overflow-y: auto;
}

.drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.drawer-header h2 { font-size: 20px; color: #c4b5fd; }

.close-btn {
  background: none;
  border: none;
  color: #94a3b8;
  font-size: 24px;
  cursor: pointer;
}

/* Admin tabs */
.admin-tabs {
  display: flex;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.admin-tabs button {
  flex: 1;
  padding: 12px;
  background: none;
  border: none;
  color: #94a3b8;
  font-size: 14px;
  cursor: pointer;
  border-bottom: 3px solid transparent;
}

.admin-tabs button.active {
  color: #c4b5fd;
  border-bottom-color: #7c3aed;
}

.tab-content {
  padding: 16px 20px;
  flex: 1;
}

/* Add form */
.add-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.add-form input {
  padding: 12px 16px;
  border-radius: 12px;
  border: 2px solid rgba(124, 58, 237, 0.3);
  background: rgba(255, 255, 255, 0.05);
  color: #e2e8f0;
  font-size: 16px;
}

.add-form input:focus {
  outline: none;
  border-color: #7c3aed;
}

.btn-save {
  background: linear-gradient(135deg, #22c55e, #16a34a);
  color: white;
  border: none;
  padding: 12px;
  border-radius: 12px;
  font-size: 16px;
  cursor: pointer;
}

.btn-save:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.save-msg {
  color: #22c55e;
  font-size: 14px;
  text-align: center;
}

/* Word list */
.search-input {
  width: 100%;
  padding: 10px 16px;
  border-radius: 12px;
  border: 2px solid rgba(124, 58, 237, 0.3);
  background: rgba(255, 255, 255, 0.05);
  color: #e2e8f0;
  font-size: 14px;
  margin-bottom: 12px;
}

.word-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 50vh;
  overflow-y: auto;
}

.word-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 10px;
}

.word-info {
  display: flex;
  gap: 12px;
  align-items: center;
}

.word-en {
  font-size: 16px;
  font-weight: bold;
  color: #e2e8f0;
}

.word-zh {
  font-size: 14px;
  color: #94a3b8;
}

.word-actions {
  display: flex;
  gap: 6px;
}

.btn-sm {
  padding: 6px 12px;
  border-radius: 8px;
  border: none;
  font-size: 12px;
  cursor: pointer;
}

.btn-edit {
  background: rgba(124, 58, 237, 0.3);
  color: #c4b5fd;
}

.btn-del {
  background: rgba(239, 68, 68, 0.3);
  color: #f87171;
}

/* Stats */
.stats-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.stats-tabs button {
  padding: 6px 12px;
  border-radius: 8px;
  border: none;
  background: rgba(255, 255, 255, 0.05);
  color: #94a3b8;
  font-size: 12px;
  cursor: pointer;
}

.stats-tabs button.active {
  background: rgba(124, 58, 237, 0.3);
  color: #c4b5fd;
}

.stats-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.word-stats-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 40vh;
  overflow-y: auto;
}

.word-stat-item {
  display: flex;
  justify-content: space-between;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
}

.ws-word { font-size: 14px; color: #e2e8f0; }
.ws-accuracy { font-size: 14px; font-weight: bold; }
.ws-accuracy.good { color: #22c55e; }
.ws-accuracy.warn { color: #f59e0b; }
.ws-accuracy.bad { color: #ef4444; }

.daily-item {
  display: flex;
  justify-content: space-between;
  padding: 10px 14px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 10px;
  font-size: 14px;
}

.d-date { color: #c4b5fd; font-weight: bold; }
.d-count { color: #94a3b8; }
.d-accuracy { color: #fbbf24; font-weight: bold; }

/* Trend chart */
.trend-chart {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.trend-bar {
  display: flex;
  align-items: center;
  gap: 10px;
}

.trend-label {
  font-size: 13px;
  color: #94a3b8;
  min-width: 60px;
}

.trend-fill {
  flex: 1;
  height: 20px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  overflow: hidden;
}

.trend-fill-inner {
  height: 100%;
  background: linear-gradient(90deg, #7c3aed, #a78bfa);
  border-radius: 10px;
  transition: width 0.5s ease;
}

.trend-value {
  font-size: 13px;
  color: #fbbf24;
  min-width: 45px;
  text-align: right;
}

/* Worst words */
.worst-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 10px;
}

.worst-rank {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: rgba(124, 58, 237, 0.3);
  color: #c4b5fd;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: bold;
}

.worst-word {
  flex: 1;
  font-size: 14px;
  color: #e2e8f0;
}

.worst-accuracy {
  font-size: 14px;
  font-weight: bold;
}

/* Edit modal */
.edit-modal {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
}

.edit-form {
  background: #1e1e3f;
  padding: 24px;
  border-radius: 16px;
  width: min(350px, 85vw);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.edit-form h3 { color: #c4b5fd; margin-bottom: 4px; }

.edit-form input {
  padding: 10px 14px;
  border-radius: 10px;
  border: 2px solid rgba(124, 58, 237, 0.3);
  background: rgba(255, 255, 255, 0.05);
  color: #e2e8f0;
  font-size: 14px;
}

.edit-form input:focus {
  outline: none;
  border-color: #7c3aed;
}

.edit-actions {
  display: flex;
  gap: 10px;
}

.btn-cancel {
  background: rgba(255, 255, 255, 0.1);
  color: #94a3b8;
  border: none;
  padding: 10px 20px;
  border-radius: 10px;
  cursor: pointer;
}

.btn-load {
  background: rgba(124, 58, 237, 0.3);
  color: #c4b5fd;
  border: none;
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 13px;
  cursor: pointer;
  margin-bottom: 8px;
}

.empty-hint {
  text-align: center;
  color: #64748b;
  padding: 20px;
}

/* Responsive — landscape phone */
@media (orientation: landscape) and (max-height: 500px) {
  .quiz-card { padding: 10px 20px; }
  .chinese { font-size: 28px; margin-bottom: 10px; }
  .english { font-size: 36px; margin-bottom: 10px; }
  header h1 { font-size: 20px; }
  .action-buttons { gap: 10px; }
  .btn-correct, .btn-wrong { padding: 10px 24px; font-size: 16px; }
}
```

- [ ] **Step 3: Create Alpine.js application logic**

Create `public/app.js`:

```javascript
function quizApp() {
  return {
    // State
    view: 'quiz',
    loading: false,
    quizWords: [],
    currentIndex: 0,
    currentWord: null,
    revealed: false,
    answered: false,
    isCorrect: false,
    markWrong: false,
    showAdmin: false,
    adminTab: 'add',
    statsTab: 'word',

    // Add word
    newEnglish: '',
    newChinese: '',
    saveMsg: '',

    // Word list
    allWords: [],
    searchQuery: '',

    // Edit
    editingWord: null,
    editEnglish: '',
    editChinese: '',
    editId: null,

    // Stats
    wordStats: [],
    dailyStats: [],
    trendData: [],
    worstWords: [],

    async init() {
      await this.fetchWords();
      await this.startQuiz();
    },

    // Quiz flow
    async startQuiz() {
      this.loading = true;
      this.revealed = false;
      this.answered = false;
      try {
        const res = await fetch('/api/quiz/today');
        const data = await res.json();
        this.quizWords = data.words || [];
        this.currentIndex = 0;
        this.currentWord = this.quizWords[0] || null;
      } catch (e) {
        console.error('Failed to load quiz:', e);
      }
      this.loading = false;
    },

    reveal() {
      this.revealed = true;
    },

    async markCorrect() {
      this.isCorrect = true;
      this.markWrong = false;
      this.answered = true;
      this.createFallingStars();
      await this.recordAnswer(1);
    },

    async markIncorrect() {
      this.isCorrect = false;
      this.markWrong = true;
      this.answered = true;
      await this.recordAnswer(0);
    },

    async recordAnswer(correct) {
      if (!this.currentWord) return;
      try {
        await fetch('/api/quiz/record', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ word_id: this.currentWord.id, correct }),
        });
      } catch (e) {
        console.error('Failed to record:', e);
      }
    },

    nextWord() {
      this.currentIndex++;
      if (this.currentIndex < this.quizWords.length) {
        this.currentWord = this.quizWords[this.currentIndex];
        this.revealed = false;
        this.answered = false;
        this.markWrong = false;
      }
    },

    // Word management
    async fetchWords() {
      try {
        const res = await fetch('/api/words');
        this.allWords = await res.json();
      } catch (e) {
        console.error('Failed to fetch words:', e);
      }
    },

    get filteredWords() {
      if (!this.searchQuery) return this.allWords;
      const q = this.searchQuery.toLowerCase();
      return this.allWords.filter(w =>
        w.english.toLowerCase().includes(q) || w.chinese.includes(q)
      );
    },

    async addWord() {
      if (!this.newEnglish || !this.newChinese) return;
      try {
        const res = await fetch('/api/words', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ english: this.newEnglish, chinese: this.newChinese }),
        });
        if (res.ok) {
          this.newEnglish = '';
          this.newChinese = '';
          this.saveMsg = '✅ 添加成功！';
          setTimeout(() => this.saveMsg = '', 2000);
          await this.fetchWords();
        } else {
          const data = await res.json();
          this.saveMsg = `❌ ${data.error}`;
        }
      } catch (e) {
        this.saveMsg = '❌ 添加失败';
      }
    },

    editWord(word) {
      this.editingWord = true;
      this.editId = word.id;
      this.editEnglish = word.english;
      this.editChinese = word.chinese;
    },

    async saveEdit() {
      try {
        const res = await fetch(`/api/words/${this.editId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ english: this.editEnglish, chinese: this.editChinese }),
        });
        if (res.ok) {
          this.editingWord = null;
          await this.fetchWords();
        }
      } catch (e) {
        console.error('Failed to edit:', e);
      }
    },

    async deleteWord(id) {
      if (!confirm('确定删除？')) return;
      try {
        await fetch(`/api/words/${id}`, { method: 'DELETE' });
        await this.fetchWords();
      } catch (e) {
        console.error('Failed to delete:', e);
      }
    },

    // Stats
    async loadAllWordStats() {
      this.wordStats = [];
      for (const word of this.allWords) {
        try {
          const res = await fetch(`/api/stats/word/${word.id}`);
          const data = await res.json();
          this.wordStats.push(data);
        } catch (e) { /* skip */ }
      }
    },

    async loadDailyStats() {
      try {
        const res = await fetch('/api/stats/daily');
        this.dailyStats = await res.json();
      } catch (e) { console.error(e); }
    },

    async loadTrendData() {
      try {
        const res = await fetch('/api/stats/trend?period=week');
        this.trendData = await res.json();
      } catch (e) { console.error(e); }
    },

    async loadWorstWords() {
      try {
        const res = await fetch('/api/stats/worst?limit=10');
        this.worstWords = await res.json();
      } catch (e) { console.error(e); }
    },

    // Watch for tab changes to lazy-load stats
    setStatsTab(tab) {
      this.statsTab = tab;
      if (tab === 'daily' && this.dailyStats.length === 0) this.loadDailyStats();
      if (tab === 'trend' && this.trendData.length === 0) this.loadTrendData();
      if (tab === 'worst' && this.worstWords.length === 0) this.loadWorstWords();
    },

    // Falling stars animation
    createFallingStars() {
      const container = document.getElementById('stars');
      for (let i = 0; i < 12; i++) {
        const star = document.createElement('div');
        star.className = 'star';
        star.style.left = Math.random() * 100 + '%';
        star.style.top = '-10px';
        star.style.width = (Math.random() * 4 + 2) + 'px';
        star.style.height = star.style.width;
        star.style.animation = `fall ${Math.random() * 2 + 1.5}s linear forwards`;
        star.style.animationDelay = Math.random() * 0.5 + 's';
        container.appendChild(star);
        setTimeout(() => star.remove(), 3000);
      }
    },
  };
}

// Initialize ambient stars on page load
document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('stars');
  for (let i = 0; i < 50; i++) {
    const star = document.createElement('div');
    star.className = 'star';
    star.style.left = Math.random() * 100 + '%';
    star.style.top = Math.random() * 100 + '%';
    star.style.animationDelay = Math.random() * 3 + 's';
    container.appendChild(star);
  }
});
```

- [ ] **Step 4: Fix the stats tab switching in HTML**

In `public/index.html`, the stats tab buttons use `@click="statsTab = 'xxx'"` but we need lazy loading. Update the stats tab buttons:

```html
<nav class="stats-tabs">
  <button :class="{ active: statsTab === 'word' }" @click="statsTab = 'word'">单词详情</button>
  <button :class="{ active: statsTab === 'daily' }" @click="setStatsTab('daily')">每日报告</button>
  <button :class="{ active: statsTab === 'trend' }" @click="setStatsTab('trend')">趋势</button>
  <button :class="{ active: statsTab === 'worst' }" @click="setStatsTab('worst')">错词排行</button>
</nav>
```

- [ ] **Step 5: Manual test — start the server**

```bash
cd /home/ubuntu/codes/word-tester
npm start &
```

Open browser to `http://localhost:3000`. Verify:
1. Empty state shows
2. Add a word via admin panel (gear icon → 添加 → input → save)
3. Start quiz, see Chinese, click reveal, mark correct/incorrect
4. Check stats tab shows data
5. Test falling stars animation on correct answer

```bash
kill %1 2>/dev/null
```

- [ ] **Step 6: Commit**

```bash
git add public/
git commit -m "feat: frontend SPA with quiz flow, admin panel, and starry theme"
```

---

### Task 6: Docker Configuration and Deployment

**Files:**
- Create: `Dockerfile`
- Create: `docker-compose.yml`
- Create: `.dockerignore`

- [ ] **Step 1: Create Dockerfile**

Create `Dockerfile`:

```dockerfile
FROM node:20-alpine

RUN apk add --no-cache curl

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY src/ ./src/
COPY public/ ./public/

RUN mkdir -p /app/data && chown -R node:node /app/data

USER node

ENV DB_DIR=/app/data
ENV PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD curl -f http://localhost:3000/api/words || exit 1

CMD ["node", "src/server.js"]
```

- [ ] **Step 2: Create .dockerignore**

Create `.dockerignore`:

```
node_modules
data
*.db
.git
.superpowers
docs
test
.claude
```

- [ ] **Step 3: Create docker-compose.yml**

Create `docker-compose.yml`:

```yaml
services:
  word-quiz:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - word-data:/app/data
    restart: unless-stopped

volumes:
  word-data:
```

- [ ] **Step 4: Build and test Docker**

```bash
cd /home/ubuntu/codes/word-tester
docker compose up -d --build
```

Wait for build to complete, then test:

```bash
curl http://localhost:3000/api/words
```

Expected: `[]`

```bash
docker compose down
```

- [ ] **Step 5: Final commit**

```bash
git add Dockerfile docker-compose.yml .dockerignore
git commit -m "feat: Docker deployment configuration with volume persistence"
```

---

## Task Summary

| Task | What it builds |
|------|---------------|
| 1 | Project skeleton, SQLite database, Express server |
| 2 | Word CRUD API with tests |
| 3 | Quiz generation and answer recording API with tests |
| 4 | Statistics API (per-word, daily, trend, worst) with tests |
| 5 | Frontend SPA — quiz flow, admin panel, starry theme |
| 6 | Docker configuration for one-command deployment |
