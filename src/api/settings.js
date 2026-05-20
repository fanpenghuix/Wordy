import express from 'express';
import db from '../db.js';

const router = express.Router();

const VOICE_DEFAULTS = { gender: 'female', voiceName: '', speed: '0.85' };

// Bulk get all preferences for the current user
router.get('/all', (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'Unauthorized' });

  const prefs = db.prepare('SELECT key, value FROM user_preferences WHERE user_id = ?').all(req.session.userId);
  const result = {};
  for (const p of prefs) {
    result[p.key] = p.value;
  }
  res.json(result);
});

// Get voice settings
router.get('/voice', (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'Unauthorized' });

  const stmt = db.prepare('SELECT value FROM user_preferences WHERE user_id = ? AND key = ?');
  const get = (key) => stmt.get(req.session.userId, key)?.value;

  res.json({
    gender: get('speakGender') ?? VOICE_DEFAULTS.gender,
    voiceName: get('speakVoiceName') ?? VOICE_DEFAULTS.voiceName,
    speed: get('speakSpeed') ?? VOICE_DEFAULTS.speed,
  });
});

// Update voice settings
router.put('/voice', (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'Unauthorized' });

  const { gender, voiceName, speed } = req.body;
  if (gender !== undefined && !['male', 'female'].includes(gender)) {
    return res.status(400).json({ error: 'Invalid gender' });
  }
  if (speed !== undefined && (isNaN(speed) || speed < 0.25 || speed > 4.0)) {
    return res.status(400).json({ error: 'Invalid speed' });
  }

  const upsert = db.prepare(`
    INSERT INTO user_preferences (user_id, key, value) VALUES (?, ?, ?)
    ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `);

  const entries = [];
  if (gender !== undefined) entries.push(['speakGender', gender]);
  if (voiceName !== undefined) entries.push(['speakVoiceName', voiceName]);
  if (speed !== undefined) entries.push(['speakSpeed', String(speed)]);

  if (entries.length === 0) return res.status(400).json({ error: 'No settings to update' });

  db.transaction((userId, items) => {
    for (const [key, value] of items) upsert.run(userId, key, String(value));
  })(req.session.userId, entries);

  res.json({ success: true });
});

// --- Quiz Limit Settings ---

const QUIZ_LIMIT_DEFAULTS = { mode: 'ratio', value: '20' };

router.get('/quizLimit', (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'Unauthorized' });

  const stmt = db.prepare('SELECT value FROM user_preferences WHERE user_id = ? AND key = ?');
  const get = (key) => stmt.get(req.session.userId, key)?.value;

  res.json({
    mode: get('quizLimitMode') ?? QUIZ_LIMIT_DEFAULTS.mode,
    value: Number(get('quizLimitValue') ?? QUIZ_LIMIT_DEFAULTS.value),
  });
});

router.put('/quizLimit', (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'Unauthorized' });

  const { mode, value } = req.body;
  if (!['fixed', 'ratio'].includes(mode)) {
    return res.status(400).json({ error: 'Invalid mode. Must be "fixed" or "ratio"' });
  }
  if (typeof value !== 'number' || value <= 0) {
    return res.status(400).json({ error: 'Invalid value. Must be a positive number' });
  }
  if (mode === 'ratio' && value > 100) {
    return res.status(400).json({ error: 'Ratio cannot exceed 100' });
  }
  if (mode === 'fixed' && value > 9999) {
    return res.status(400).json({ error: 'Fixed limit cannot exceed 9999' });
  }

  const upsert = db.prepare(`
    INSERT INTO user_preferences (user_id, key, value) VALUES (?, ?, ?)
    ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `);

  db.transaction((userId) => {
    upsert.run(userId, 'quizLimitMode', mode);
    upsert.run(userId, 'quizLimitValue', String(value));
  })(req.session.userId);

  res.json({ success: true });
});

// --- Spell Mode Setting ---

const SPELL_MODE_DEFAULT = false;

router.get('/spellMode', (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'Unauthorized' });

  const val = db.prepare('SELECT value FROM user_preferences WHERE user_id = ? AND key = ?')
    .get(req.session.userId, 'spellMode')?.value;

  res.json({ spellMode: val !== undefined ? val === 'true' : SPELL_MODE_DEFAULT });
});

router.put('/spellMode', (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'Unauthorized' });

  const { spellMode } = req.body;
  if (typeof spellMode !== 'boolean') {
    return res.status(400).json({ error: 'spellMode must be a boolean' });
  }

  db.prepare(`
    INSERT INTO user_preferences (user_id, key, value) VALUES (?, ?, ?)
    ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `).run(req.session.userId, 'spellMode', spellMode ? 'true' : 'false');

  res.json({ success: true });
});

export default router;
