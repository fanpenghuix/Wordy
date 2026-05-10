# Multi-User System Design

**Date:** 2026-05-10
**Status:** Approved

## Overview

Add user authentication and data isolation so that words, quizzes, and stats are per-user. Entry point is a login page. Default admin user: `admin` / `Admin123456`. Admin gets a user management panel; all other users are "user" role.

## Database

### New table: `users`

```sql
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin', 'user')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### Alter existing tables

```sql
ALTER TABLE words ADD COLUMN user_id INTEGER REFERENCES users(id);
ALTER TABLE quiz_records ADD COLUMN user_id INTEGER REFERENCES users(id);
```

### Data migration

1. Create the `admin` user (hashed password) on first app start if no users exist.
2. Update all existing words and quiz_records rows to `user_id = admin.id`.
3. Future writes always include `user_id`.

## Session & Auth

### Stack

- `express-session` with MemoryStore (in-memory, lost on restart — acceptable for this use case).
- Password hashing: `bcrypt` (lightweight, standard for this).
- Session cookie: default settings, `httpOnly: true`.
- Secret: env var `SESSION_SECRET` or random string fallback.

### Session shape

```js
req.session = { userId: 1, username: 'admin', role: 'admin' }
```

### Auth API

| Route | Method | Auth | Description |
|-------|--------|------|-------------|
| `/api/auth/login` | POST | None | Body: `{ username, password }`. On success, writes session. Returns `{ user: { id, username, role } }`. |
| `/api/auth/logout` | POST | Required | Destroys session. |
| `/api/auth/me` | GET | None | Returns current user from session or 401. |

### Middleware

- `requireAuth` — returns 401 if no `req.session.userId`.
- `requireAdmin` — returns 403 if `req.session.role !== 'admin'`.
- Auth middleware injects `req.userId = req.session.userId` for convenience.

## API Changes

### New routes

| Route | Method | Auth | Description |
|-------|--------|------|-------------|
| `/api/users` | GET | Admin | List all users (id, username, role, created_at, excludes password_hash). |
| `/api/users` | POST | Admin | Create user: `{ username, password, role }`. Hash password, insert. |
| `/api/users/:id` | PUT | Admin | Update user: change username, password (optional), role. Cannot delete self. |
| `/api/users/:id` | DELETE | Admin | Delete user + cascade delete their words and quiz_records. Cannot delete self. |

### Existing route changes

All existing word/quiz/stats queries must filter by `req.userId`:

- `GET /api/words` → `WHERE user_id = req.userId`
- `POST /api/words` → `INSERT ... user_id = req.userId`
- `PUT/DELETE /api/words/:id` → `WHERE id = ? AND user_id = req.userId`
- `GET/POST /api/quiz` → `WHERE user_id = req.userId` for both word selection and record insertion
- `GET /api/stats` → `WHERE user_id = req.userId` for all stats queries

## Frontend Changes

### Login page

- Default view when no `currentUser` exists.
- Simple form: username + password → POST `/api/auth/login`.
- On success, set Alpine `currentUser` global state, navigate to quiz view.
- On failure, show error message.

### Global state

- `currentUser` object: `{ id, username, role }` or `null`.
- On app load: GET `/api/auth/me` to restore session.
- Logout button clears `currentUser` and calls POST `/api/auth/logout`.

### Admin user management panel

- New tab in the settings/admin section, visible only when `currentUser.role === 'admin'`.
- Table: username, role, created_at, actions (edit, delete).
- Edit: modal to change username, password, role.
- Delete user: confirmation dialog. Handler deletes user's words and quiz_records first, then the user row. Cannot delete self.
- Cannot edit/delete own admin account.

### Data isolation

All data views (word list, quiz, stats) automatically scoped to logged-in user — no UI changes needed beyond login/logout flow.

## Security

- Passwords hashed with bcrypt (salt rounds: 10).
- Session cookies httpOnly.
- Admin-only routes protected by `requireAdmin` middleware.
- Delete user cascades to their words and quiz_records.
- Default admin password must be changed by admin (suggestion, not enforced).

## Risks

- MemoryStore means session loss on restart — users must re-login. Acceptable.
- Existing data migrated to admin user — no data loss.
