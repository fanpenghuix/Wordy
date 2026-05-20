import { describe, it, expect } from 'vitest';
import db from '../src/db.js';
import { initSm2Review, recordResult } from '../src/algorithms/sm2.js';

describe('SM-2 Algorithm', () => {
  const today = new Date().toISOString().slice(0, 10);

  function setupUserWord(username, english, chinese) {
    const user = db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(username, 'hash', 'user');
    const word = db.prepare('INSERT INTO words (english, chinese, user_id) VALUES (?, ?, ?)').run(english, chinese, user.lastInsertRowid);
    return { userId: user.lastInsertRowid, wordId: word.lastInsertRowid };
  }

  function cleanup(userId) {
    db.prepare('DELETE FROM sm2_reviews WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM words WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  }

  describe('initSm2Review', () => {
    it('creates initial state with correct defaults', () => {
      const { userId, wordId } = setupUserWord('sm2_init', 'test', '测试');
      initSm2Review(userId, wordId);
      const state = db.prepare('SELECT * FROM sm2_reviews WHERE user_id = ? AND word_id = ?').get(userId, wordId);
      expect(state.interval).toBe(0);
      expect(state.efactor).toBe(2.5);
      expect(state.repetitions).toBe(0);
      expect(state.next_review).toBe(today);
      cleanup(userId);
    });
  });

  describe('correct answers', () => {
    it('first correct: interval=1, repetitions=1', () => {
      const { userId, wordId } = setupUserWord('sm2_c1', 'c1', '正确1');
      initSm2Review(userId, wordId);
      recordResult(userId, wordId, true);
      const state = db.prepare('SELECT * FROM sm2_reviews WHERE user_id = ? AND word_id = ?').get(userId, wordId);
      expect(state.repetitions).toBe(1);
      expect(state.interval).toBe(1);
      expect(state.efactor).toBe(2.5);
      cleanup(userId);
    });

    it('second correct: interval=3, repetitions=2', () => {
      const { userId, wordId } = setupUserWord('sm2_c2', 'c2', '正确2');
      initSm2Review(userId, wordId);
      recordResult(userId, wordId, true);
      recordResult(userId, wordId, true);
      const state = db.prepare('SELECT * FROM sm2_reviews WHERE user_id = ? AND word_id = ?').get(userId, wordId);
      expect(state.repetitions).toBe(2);
      expect(state.interval).toBe(3);
      cleanup(userId);
    });

    it('third+ correct: interval = Math.round(interval * efactor)', () => {
      const { userId, wordId } = setupUserWord('sm2_c3', 'c3', '正确3');
      initSm2Review(userId, wordId);
      recordResult(userId, wordId, true);
      recordResult(userId, wordId, true);
      recordResult(userId, wordId, true);
      const state = db.prepare('SELECT * FROM sm2_reviews WHERE user_id = ? AND word_id = ?').get(userId, wordId);
      expect(state.repetitions).toBe(3);
      expect(state.interval).toBe(8); // Math.round(3 * 2.5) = 8
      cleanup(userId);
    });
  });

  describe('wrong answers', () => {
    it('resets repetitions=0, interval=0, reduces efactor', () => {
      const { userId, wordId } = setupUserWord('sm2_w1', 'w1', '错误1');
      initSm2Review(userId, wordId);
      recordResult(userId, wordId, true);
      recordResult(userId, wordId, true);
      recordResult(userId, wordId, false);
      const state = db.prepare('SELECT * FROM sm2_reviews WHERE user_id = ? AND word_id = ?').get(userId, wordId);
      expect(state.repetitions).toBe(0);
      expect(state.interval).toBe(0);
      expect(state.efactor).toBe(2.3);
      expect(state.next_review).toBe(today);
      cleanup(userId);
    });

    it('efactor minimum is 1.3', () => {
      const { userId, wordId } = setupUserWord('sm2_ef', 'ef', '系数');
      initSm2Review(userId, wordId);
      for (let i = 0; i < 10; i++) recordResult(userId, wordId, false);
      const state = db.prepare('SELECT * FROM sm2_reviews WHERE user_id = ? AND word_id = ?').get(userId, wordId);
      expect(state.efactor).toBe(1.3);
      cleanup(userId);
    });
  });

  describe('user isolation', () => {
    it('different users have independent state', () => {
      const u1 = setupUserWord('sm2_u1', 'iso1', '隔离1');
      const u2 = setupUserWord('sm2_u2', 'iso2', '隔离2');
      initSm2Review(u1.userId, u1.wordId);
      initSm2Review(u2.userId, u2.wordId);
      for (let i = 0; i < 3; i++) recordResult(u1.userId, u1.wordId, true);
      recordResult(u2.userId, u2.wordId, false);
      const s1 = db.prepare('SELECT * FROM sm2_reviews WHERE user_id = ?').get(u1.userId);
      const s2 = db.prepare('SELECT * FROM sm2_reviews WHERE user_id = ?').get(u2.userId);
      expect(s1.repetitions).toBe(3);
      expect(s2.repetitions).toBe(0);
      cleanup(u1.userId);
      cleanup(u2.userId);
    });
  });
});
