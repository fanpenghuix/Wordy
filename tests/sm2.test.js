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
    db.prepare('DELETE FROM quiz_session WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM quiz_records WHERE user_id = ?').run(userId);
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

    it('second correct on same day: deduped to first review result', () => {
      const { userId, wordId } = setupUserWord('sm2_c2', 'c2', '正确2');
      initSm2Review(userId, wordId);
      recordResult(userId, wordId, true);
      recordResult(userId, wordId, true);
      const state = db.prepare('SELECT * FROM sm2_reviews WHERE user_id = ? AND word_id = ?').get(userId, wordId);
      // Same-day dedup: second review recalculates from pre-today state, so still interval=1, rep=1
      expect(state.repetitions).toBe(1);
      expect(state.interval).toBe(1);
      cleanup(userId);
    });

    it('third+ correct on same day: all deduped to first review', () => {
      const { userId, wordId } = setupUserWord('sm2_c3', 'c3', '正确3');
      initSm2Review(userId, wordId);
      recordResult(userId, wordId, true);
      recordResult(userId, wordId, true);
      recordResult(userId, wordId, true);
      const state = db.prepare('SELECT * FROM sm2_reviews WHERE user_id = ? AND word_id = ?').get(userId, wordId);
      // Same-day dedup: all collapse to first review from pre-today state
      expect(state.repetitions).toBe(1);
      expect(state.interval).toBe(1);
      cleanup(userId);
    });

    it('caps interval at MAX_INTERVAL (5 days)', () => {
      const { userId, wordId } = setupUserWord('sm2_cap', 'cap', '上限');
      initSm2Review(userId, wordId);
      for (let i = 0; i < 15; i++) {
        recordResult(userId, wordId, true);
      }
      const state = db.prepare('SELECT * FROM sm2_reviews WHERE user_id = ? AND word_id = ?').get(userId, wordId);
      expect(state.interval).toBeLessThanOrEqual(5);
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

    it('efactor decreases on first wrong of the day', () => {
      const { userId, wordId } = setupUserWord('sm2_ef', 'ef', '系数');
      initSm2Review(userId, wordId);
      // First wrong: efactor 2.5 -> 2.3; subsequent same-day wrongs are deduped
      for (let i = 0; i < 10; i++) recordResult(userId, wordId, false);
      const state = db.prepare('SELECT * FROM sm2_reviews WHERE user_id = ? AND word_id = ?').get(userId, wordId);
      // Same-day dedup: all wrongs recalculate from pre-today {0, 2.5, 0}, so efactor = max(1.3, 2.5-0.2) = 2.3
      expect(state.efactor).toBe(2.3);
      cleanup(userId);
    });
  });

  describe('user isolation', () => {
    it('different users have independent state', () => {
      const u1 = setupUserWord('sm2_u1', 'iso1', '隔离1');
      const u2 = setupUserWord('sm2_u2', 'iso2', '隔离2');
      initSm2Review(u1.userId, u1.wordId);
      initSm2Review(u2.userId, u2.wordId);
      // u1: correct once (same-day dedup means only first review counts)
      for (let i = 0; i < 3; i++) recordResult(u1.userId, u1.wordId, true);
      recordResult(u2.userId, u2.wordId, false);
      const s1 = db.prepare('SELECT * FROM sm2_reviews WHERE user_id = ?').get(u1.userId);
      const s2 = db.prepare('SELECT * FROM sm2_reviews WHERE user_id = ?').get(u2.userId);
      // u1: deduped to first correct -> rep=1; u2: wrong -> rep=0
      expect(s1.repetitions).toBe(1);
      expect(s2.repetitions).toBe(0);
      cleanup(u1.userId);
      cleanup(u2.userId);
    });
  });

  describe('same-day dedup', () => {
    it('second correct on same day does not grow interval further', () => {
      const { userId, wordId } = setupUserWord('sm2_sd1', 'sd1', '同日1');
      initSm2Review(userId, wordId);
      // First review: interval 0 → 1
      recordResult(userId, wordId, true);
      let state = db.prepare('SELECT * FROM sm2_reviews WHERE user_id = ? AND word_id = ?').get(userId, wordId);
      expect(state.interval).toBe(1);

      // Second review same day (correct again): should still be interval 1
      recordResult(userId, wordId, true);
      state = db.prepare('SELECT * FROM sm2_reviews WHERE user_id = ? AND word_id = ?').get(userId, wordId);
      expect(state.interval).toBe(1);
      cleanup(userId);
    });

    it('second wrong on same day resets from pre-today state', () => {
      const { userId, wordId } = setupUserWord('sm2_sd2', 'sd2', '同日2');
      initSm2Review(userId, wordId);
      // First review: correct, interval 0 → 1
      recordResult(userId, wordId, true);
      let state = db.prepare('SELECT * FROM sm2_reviews WHERE user_id = ? AND word_id = ?').get(userId, wordId);
      expect(state.interval).toBe(1);
      expect(state.repetitions).toBe(1);

      // Second review same day (wrong): reset from pre-today state
      recordResult(userId, wordId, false);
      state = db.prepare('SELECT * FROM sm2_reviews WHERE user_id = ? AND word_id = ?').get(userId, wordId);
      expect(state.interval).toBe(0);
      expect(state.repetitions).toBe(0);
      expect(state.next_review).toBe(new Date().toISOString().slice(0, 10));
      cleanup(userId);
    });

    it('multiple reviews on same day: always uses pre-today state', () => {
      const { userId, wordId } = setupUserWord('sm2_sd3', 'sd3', '同日3');
      initSm2Review(userId, wordId);
      // First: correct → interval=1
      recordResult(userId, wordId, true);
      // Second: wrong → reset to interval=0
      recordResult(userId, wordId, false);
      // Third: correct → from pre-today state (interval=0, rep=0) → interval=1
      recordResult(userId, wordId, true);
      const state = db.prepare('SELECT * FROM sm2_reviews WHERE user_id = ? AND word_id = ?').get(userId, wordId);
      expect(state.interval).toBe(1);
      expect(state.repetitions).toBe(1);
      cleanup(userId);
    });
  });
});
