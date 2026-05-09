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

// SPA fallback -- serve index.html for all non-API routes
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
