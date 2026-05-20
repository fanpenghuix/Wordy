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

// GET /api/users/:id/words — get user's word count
router.get('/:id/words', (req, res) => {
  const id = Number(req.params.id);
  const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const count = db.prepare('SELECT COUNT(*) as total FROM words WHERE user_id = ?').get(id);
  res.json({ userId: id, username: user.username, wordCount: count.total });
});

export default router;
