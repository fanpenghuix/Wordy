import db from '../db.js';
import { getSm2DueWords, recordResult as sm2RecordResult, initSm2Review } from './sm2.js';

function getActiveStrategy() {
  const name = process.env.ACTIVE_STRATEGY || 'sm2';
  if (name === 'sm2') {
    return { getDueWords: getSm2DueWords, recordResult: sm2RecordResult, initWord: initSm2Review };
  }
  // Legacy: 15% random
  const today = () => new Date().toISOString().slice(0, 10);
  return {
    getDueWords(userId, limit) {
      const words = db.prepare('SELECT * FROM words WHERE user_id = ?').all(userId);
      const newWords = words.filter(w => w.created_at === today());
      const otherWords = words.filter(w => w.created_at !== today());
      const count = limit || Math.ceil(otherWords.length * 0.15);
      const shuffled = otherWords.sort(() => Math.random() - 0.5);
      return [...newWords, ...shuffled.slice(0, count)].sort(() => Math.random() - 0.5);
    },
    recordResult() {},
    initWord() {},
  };
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
