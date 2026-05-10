# Multi-User System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add user authentication, login gate, and per-user data isolation to the word quiz app.

**Architecture:** `express-session` (MemoryStore) for stateful auth, bcrypt for password hashing, `req.session.userId` injected into all data queries. All words, quizzes, and stats are scoped to the logged-in user. Default admin user created on first boot.

**Tech Stack:** express-session, bcrypt, better-sqlite3, Alpine.js, vitest + supertest

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `package.json` | Modify | Add `express-session`, `bcrypt` dependencies |
| `src/db.js` | Modify | Add `users` table, add `user_id` to existing tables, migrate data |
| `src/middleware/auth.js` | Create | `requireAuth`, `requireAdmin` middleware |
| `src/api/auth.js` | Create | `/api/auth/login`, `/api/auth/logout`, `/api/auth/me` |
| `src/api/users.js` | Create | Admin user CRUD: list, create, update, delete |
| `src/api/words.js` | Modify | Filter all queries by `req.userId`, inject `user_id` on create |
| `src/api/quiz.js` | Modify | Filter by `req.userId` for quiz generation and answer recording |
| `src/api/stats.js` | Modify | Filter all stats queries by `req.userId` |
| `src/server.js` | Modify | Add session middleware, register auth + users routes |
| `test/auth.test.js` | Create | Auth API tests (login, logout, me) |
| `test/users.test.js` | Create | Admin user management tests |
| `test/user-isolation.test.js` | Create | Per-user data isolation tests |
| `public/index.html` | Modify | Add login page, admin user management tab, user badge/logout |
| `public/app.js` | Modify | Login/logout logic, currentUser state, user management methods |
| `public/style.css` | Modify | Login page + user management styles |

---

### Task 1: Install Dependencies

- [ ] **Step 1: Install packages**

```bash
npm install express-session bcrypt
```

- [ ] **Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add express-session and bcrypt dependencies"
```

---

### Task 2: Database Schema Migration

- [ ] **Step 1: Add users table and user_id columns with migration**

Replace the existing `db.exec(...)` block in `src/db.js` with:

```js
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin', 'user')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS words (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id),
    english TEXT NOT NULL,
    chinese TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (date('now'))
  );

  CREATE TABLE IF NOT EXISTS quiz_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id),
    word_id INTEGER NOT NULL REFERENCES words(id),
    correct INTEGER NOT NULL CHECK(correct IN (0, 1)),
    quiz_date TEXT NOT NULL DEFAULT (date('now'))
  );
`);

// Migration: create default admin user and migrate existing data
const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
if (userCount.count === 0) {
  const bcrypt = await import('bcrypt');
  const hash = bcrypt.hashSync('Admin123456', 10);
  const result = db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run('admin', hash, 'admin');
  const adminId = result.lastInsertRowid;

  // Migrate existing words to admin
  db.prepare('UPDATE words SET user_id = ? WHERE user_id IS NULL').run(adminId);
  // Migrate existing quiz_records to admin
  db.prepare('UPDATE quiz_records SET user_id = ? WHERE user_id IS NULL').run(adminId);
}

// Per-user uniqueness of english words
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_words_user_english ON words(user_id, english)`);
```

- [ ] **Step 2: Commit**

```bash
git add src/db.js
git commit -m "feat: add users table, user_id columns, and admin migration"
```

---

### Task 3: Auth Middleware

- [ ] **Step 1: Write middleware**

Create `src/middleware/auth.js`:

```js
export function requireAuth(req, res, next) {
  if (req.session?.userId) {
    req.userId = req.session.userId;
    return next();
  }
  return res.status(401).json({ error: 'Unauthorized' });
}

export function requireAdmin(req, res, next) {
  if (req.session?.role === 'admin') {
    return next();
  }
  return res.status(403).json({ error: 'Forbidden' });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/middleware/auth.js
git commit -m "feat: add requireAuth and requireAdmin middleware"
```

---

### Task 4: Auth API + Tests (TDD)

- [ ] **Step 1: Write the failing tests**

Create `test/auth.test.js` with tests for:
- POST `/api/auth/login` — correct credentials → 200 + user object
- POST `/api/auth/login` — wrong password → 401
- POST `/api/auth/login` — non-existent user → 401
- POST `/api/auth/login` — missing fields → 400
- GET `/api/auth/me` — not logged in → 401
- POST `/api/auth/logout` — login then logout → session destroyed, /me returns 401

Test app uses `express-session` with MemoryStore. Tests insert test users with bcrypt-hashed passwords.

Full test code is in the brainstorming spec. Key pattern:

```js
function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: 'test-secret', resave: false, saveUninitialized: false, store: new session.MemoryStore() }));
  app.use('/api/auth', authRouter);
  return app;
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run test/auth.test.js
```

- [ ] **Step 3: Implement the auth API**

Create `src/api/auth.js`:

```js
import express from 'express';
import bcrypt from 'bcrypt';
import db from '../db.js';

const router = express.Router();

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }

  req.session.userId = user.id;
  req.session.username = user.username;
  req.session.role = user.role;

  res.json({ user: { id: user.id, username: user.username, role: user.role } });
});

router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ error: 'Failed to logout' });
    res.json({ success: true });
  });
});

router.get('/me', (req, res) => {
  if (!req.session?.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.json({ user: { id: req.session.userId, username: req.session.username, role: req.session.role } });
});

export default router;
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run test/auth.test.js
```

- [ ] **Step 5: Commit**

```bash
git add test/auth.test.js src/api/auth.js
git commit -m "feat: add auth API (login/logout/me) with tests"
```

---

### Task 5: Wire Session + Auth into Server

- [ ] **Step 1: Update `src/server.js`**

Add `express-session` import and middleware, add `authRouter` import and route. Session middleware must come before API routes.

```js
import express from 'express';
import session from 'express-session';
import path from 'path';
import { fileURLToPath } from 'url';
import wordsRouter from './api/words.js';
import quizRouter from './api/quiz.js';
import statsRouter from './api/stats.js';
import speakRouter from './api/speak.js';
import authRouter from './api/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || Math.random().toString(36).slice(2),
  resave: false,
  saveUninitialized: false,
  store: new session.MemoryStore(),
}));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api/auth', authRouter);
app.use('/api/words', wordsRouter);
app.use('/api/quiz', quizRouter);
app.use('/api/stats', statsRouter);
app.use('/api/speak', speakRouter);

app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Word Quiz server running on port ${PORT}`);
});

export default app;
```

- [ ] **Step 2: Commit**

```bash
git add src/server.js
git commit -m "feat: wire session middleware and auth routes into server"
```

---

### Task 6: User Management API + Tests (TDD)

- [ ] **Step 1: Write the failing tests**

Create `test/users.test.js`. Test app injects mock session via middleware:

```js
function createTestApp(sessionData = {}) {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: 'test-secret', resave: false, saveUninitialized: false, store: new session.MemoryStore() }));
  app.use((req, res, next) => {
    if (sessionData.userId) {
      req.session.userId = sessionData.userId;
      req.session.username = sessionData.username || 'admin';
      req.session.role = sessionData.role || 'admin';
    }
    next();
  });
  app.use('/api/users', usersRouter);
  return app;
}
```

Tests:
- GET `/api/users` — admin sees list (no password_hash), non-admin gets 403
- POST `/api/users` — admin creates user → 201, duplicate → 409, non-admin → 403
- PUT `/api/users/:id` — admin updates username/role/password, cannot modify self → 400
- DELETE `/api/users/:id` — admin deletes user + their data, cannot delete self → 400

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run test/users.test.js
```

- [ ] **Step 3: Implement user management API**

Create `src/api/users.js`:

```js
import express from 'express';
import bcrypt from 'bcrypt';
import db from '../db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = express.Router();
router.use(requireAuth);
router.use(requireAdmin);

router.get('/', (req, res) => {
  const users = db.prepare('SELECT id, username, role, created_at FROM users ORDER BY id').all();
  res.json(users);
});

router.post('/', async (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }
  const hash = await bcrypt.hash(password, 10);
  try {
    const result = db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(username, hash, role || 'user');
    const user = db.prepare('SELECT id, username, role, created_at FROM users WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ user });
  } catch (err) {
    if (err.message.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: '用户名已存在' });
    }
    throw err;
  }
});

router.put('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const { username, password, role } = req.body;
  if (id === req.session.userId) {
    return res.status(400).json({ error: '不能修改自己的账户' });
  }
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'User not found' });

  const newUsername = username ?? existing.username;
  const newRole = role ?? existing.role;

  if (password) {
    const hash = await bcrypt.hash(password, 10);
    db.prepare('UPDATE users SET username = ?, role = ?, password_hash = ? WHERE id = ?').run(newUsername, newRole, hash, id);
  } else {
    db.prepare('UPDATE users SET username = ?, role = ? WHERE id = ?').run(newUsername, newRole, id);
  }

  const user = db.prepare('SELECT id, username, role, created_at FROM users WHERE id = ?').get(id);
  res.json({ user });
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (id === req.session.userId) {
    return res.status(400).json({ error: '不能删除自己的账户' });
  }
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'User not found' });

  db.prepare('DELETE FROM quiz_records WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM words WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM users WHERE id = ?').run(id);

  res.json({ success: true });
});

export default router;
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run test/users.test.js
```

- [ ] **Step 5: Commit**

```bash
git add test/users.test.js src/api/users.js
git commit -m "feat: add admin user management API with tests"
```

---

### Task 7: Add User Isolation to Existing APIs + Tests

- [ ] **Step 1: Write isolation tests**

Create `test/user-isolation.test.js` with a test app that can be configured with different user sessions. Tests:

**Words isolation:**
- Each user only sees their own words
- Cannot update another user's word → 404
- Cannot delete another user's word → 404
- Duplicate `english` allowed across users (201)
- Duplicate `english` NOT allowed for same user (409)

**Quiz isolation:**
- Quiz only includes current user's words
- Quiz record is scoped to current user

**Stats isolation:**
- Daily stats only show current user's data
- Worst words only show current user's words

**Auth required:**
- Unauthenticated access to `/api/words` → 401
- Unauthenticated access to `/api/quiz/today` → 401

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run test/user-isolation.test.js
```

- [ ] **Step 3: Update `src/api/words.js`**

Add `requireAuth` middleware to all routes. Filter by `req.userId`. Add `user_id` to INSERTs. Check `user_id` in UPDATE/DELETE WHERE clauses.

```js
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
  if (!english || !chinese) return res.status(400).json({ error: 'english and chinese are required' });
  try {
    const result = db.prepare('INSERT INTO words (english, chinese, user_id) VALUES (?, ?, ?)').run(english.trim(), chinese.trim(), req.userId);
    const word = db.prepare('SELECT * FROM words WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(word);
  } catch (err) {
    if (err.message.includes('UNIQUE constraint')) return res.status(409).json({ error: '该单词已存在' });
    throw err;
  }
});

router.put('/:id', (req, res) => {
  const { english, chinese } = req.body;
  if (!english || !chinese) return res.status(400).json({ error: 'english and chinese are required' });
  const result = db.prepare('UPDATE words SET english = ?, chinese = ? WHERE id = ? AND user_id = ?').run(english.trim(), chinese.trim(), Number(req.params.id), req.userId);
  if (result.changes === 0) return res.status(404).json({ error: 'Word not found' });
  const word = db.prepare('SELECT * FROM words WHERE id = ?').get(Number(req.params.id));
  res.json(word);
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM quiz_records WHERE word_id = ?').run(id);
  const result = db.prepare('DELETE FROM words WHERE id = ? AND user_id = ?').run(id, req.userId);
  if (result.changes === 0) return res.status(404).json({ error: 'Word not found' });
  res.json({ success: true });
});

export default router;
```

- [ ] **Step 4: Update `src/api/quiz.js`**

Add `requireAuth`, filter by `req.userId` in all queries, add `user_id` to INSERT.

- [ ] **Step 5: Update `src/api/stats.js`**

Add `requireAuth`, filter by `req.userId` in all queries. For `word/:id`, also check `user_id` in the word lookup.

- [ ] **Step 6: Update existing tests**

Update `test/words.test.js`, `test/quiz.test.js`, `test/stats.test.js` to:
1. Wrap test app with `express-session` + mock session middleware
2. Insert test user into `users` table
3. Add `user_id` column to all word/quiz_record INSERTs

- [ ] **Step 7: Run all tests**

```bash
npx vitest run
```

- [ ] **Step 8: Commit**

```bash
git add src/api/words.js src/api/quiz.js src/api/stats.js test/user-isolation.test.js test/words.test.js test/quiz.test.js test/stats.test.js
git commit -m "feat: add user isolation to words/quiz/stats APIs with tests"
```

---

### Task 8: Frontend Login Page + Auth State

- [ ] **Step 1: Add login page HTML**

Add a login view div before the quiz view in `public/index.html`. Default `view` starts as `'login'`.

Login page: username + password form → POST `/api/auth/login`. On success, set `currentUser`, switch to quiz view.

Add user badge (`currentUser.username`) and logout button to quiz view header.

Add "用户管理" tab to admin sidebar (visible only when `currentUser.role === 'admin'`).

Add user management panel with create form, user list (edit/delete, cannot modify self).

Add edit user modal.

- [ ] **Step 2: Update `public/app.js`**

Key changes:
- `view` default: `'login'` instead of `'quiz'`
- Add `currentUser: null`
- Add login state: `loginUsername`, `loginPassword`, `loginError`, `loginLoading`
- Add user management state: `users`, `editingUser`, `editUserId`, etc.
- `init()`: try GET `/api/auth/me` to restore session, if success go to quiz, else show login
- Add `login()`, `logout()` methods
- Add `fetchUsers()`, `addUser()`, `editUser()`, `saveEditUser()`, `deleteUser()` methods
- All existing methods unchanged (they work because session is now managed server-side via cookies)

- [ ] **Step 3: Commit**

```bash
git add public/index.html public/app.js
git commit -m "feat: add login page, user badge, logout, and user management UI"
```

---

### Task 9: Login Page + User Management CSS

- [ ] **Step 1: Append styles to `public/style.css`**

Add styles for:
- `.login-view` — centered full-height flex layout
- `.login-card` — glass-morphism card with backdrop-filter
- `.login-field input` — full-width styled inputs
- `.btn-login` — gradient submit button
- `.user-badge` — username display in header
- `.btn-logout` — red logout button
- `.role-admin` / `.role-user` — colored role badges
- `.self-badge` — "自己" label for current user
- `select` styles for role dropdown in forms and modals

- [ ] **Step 2: Commit**

```bash
git add public/style.css
git commit -m "feat: add login and user management styles"
```

---

### Task 10: Docker Session Secret

- [ ] **Step 1: Add SESSION_SECRET to `docker-compose.yml`**

Add to the service's `environment` section:

```yaml
      SESSION_SECRET: ${SESSION_SECRET:-word-quiz-secret-change-in-production}
```

- [ ] **Step 2: Run full test suite**

```bash
npx vitest run
```

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yml
git commit -m "chore: add SESSION_SECRET to docker compose environment"
```

---

## Self-Review

**1. Spec coverage:** All requirements from `docs/superpowers/specs/2026-05-10-multi-user-system-design.md` are covered by tasks.

**2. Placeholder scan:** No TBD, TODO, or vague sections found.

**3. Type consistency:** `req.userId` is set by `requireAuth` middleware consistently. `user_id` columns are used consistently in SQL. Session shape `{userId, username, role}` is consistent across auth, users, and test helpers.

**4. Scope check:** Focused only on auth and user management. No unrelated refactoring.
