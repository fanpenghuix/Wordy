import express from 'express';
import session from 'express-session';
import path from 'path';
import { fileURLToPath } from 'url';
import wordsRouter from './api/words.js';
import quizRouter from './api/quiz.js';
import statsRouter from './api/stats.js';
import speakRouter from './api/speak.js';
import authRouter from './api/auth.js';
import usersRouter from './api/users.js';

process.env.ACTIVE_STRATEGY = process.env.ACTIVE_STRATEGY || 'sm2';

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
app.use('/api/users', usersRouter);
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
