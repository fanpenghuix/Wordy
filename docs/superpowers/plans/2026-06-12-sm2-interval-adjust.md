# SM2 间隔调整 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 SM2 在小词库中指数增长导致单词"消失"的问题，添加最大间隔5天、同日去重、加权随机填充

**Architecture:** 修改 `src/algorithms/sm2.js` 中的 `recordResult` 和 `getDueWords` 函数，在 `src/db.js` 中添加 schema 迁移。保持对外接口不变。

**Tech Stack:** better-sqlite3, vitest, supertest

**关键背景：**
- 用户 ~100 词，每天抽查 30 词（30%），工作日每天 1~2 遍（认读+拼写）
- SM2 无上限时，连续答对8次 → 间隔 395 天 → 词消失
- 填充逻辑按 `next_review ASC` 排序，总是同一批词出现
- 一天内同一词被抽2遍，SM2 更新2次，间隔涨得更快

---

### Task 1: Schema 迁移 — 添加 `pre_today_state` 列

**Files:**
- Modify: `src/db.js`

**Purpose:** 支持同日去重。`pre_today_state` 存储今天第一次复习前的 SM2 状态（interval, efactor, repetitions）。当同一天第二次复习时，从此状态重新计算而非在第一次结果上叠加。

- [ ] **Step 1: 在 `src/db.js` 的 SM-2 reviews 创建语句后添加迁移**

在 `src/db.js` 中找到这段代码（约第114行，创建 `idx_sm2_reviews_next_review` 索引之后）：

```js
db.exec(`CREATE INDEX IF NOT EXISTS idx_sm2_reviews_next_review ON sm2_reviews(next_review)`);
```

在其后添加以下迁移：

```js
// Migration: add pre_today_state column for same-day dedup
db.exec(`
  ALTER TABLE sm2_reviews ADD COLUMN pre_today_state TEXT
`);
```

`ALTER TABLE ... ADD COLUMN` 是幂等的，在已有此列时会报错。需要用 `CREATE TABLE IF NOT EXISTS` 方式绕过，或者捕获异常。更好的做法：

```js
// Migration: add pre_today_state column for same-day dedup
try {
  db.exec(`ALTER TABLE sm2_reviews ADD COLUMN pre_today_state TEXT`);
} catch {
  // Column already exists — migration already applied
}
```

**完整 `src/db.js` 修改范围：** 只在这一处添加 try/catch 迁移代码。其他代码不变。

- [ ] **Step 2: 验证迁移**

Run: `rm -rf data-test && npm test -- tests/sm2.test.js 2>&1 | tail -15`
Expected: 测试通过（新数据库会自动创建带新列的表；旧数据库会执行迁移）

- [ ] **Step 3: Commit**

```bash
git add src/db.js
git commit -m "feat: add pre_today_state column for same-day SM2 dedup"
```

---

### Task 2: 最大间隔上限 — 5天

**Files:**
- Modify: `src/algorithms/sm2.js` — `recordResult` 函数
- Test: `tests/sm2.test.js` — 在 `correct answers` describe 块中添加

**Purpose:** 任何词的 interval 不能超过 5 天，确保小词库中所有词至少每周出现。

- [ ] **Step 1: 写测试**

在 `tests/sm2.test.js` 的 `describe('correct answers', ...)` 块中，现有第三个 correct 测试之后添加：

```js
it('caps interval at MAX_INTERVAL (5 days)', () => {
  const { userId, wordId } = setupUserWord('sm2_cap', 'cap', '上限');
  initSm2Review(userId, wordId);
  // Grow interval past 5: 1 → 3 → 8 → 20 → 50 → 125 → 313 → ...
  // Should cap at 5 each time it exceeds
  for (let i = 0; i < 15; i++) {
    recordResult(userId, wordId, true);
  }
  const state = db.prepare('SELECT * FROM sm2_reviews WHERE user_id = ? AND word_id = ?').get(userId, wordId);
  expect(state.interval).toBeLessThanOrEqual(5);
  // Also verify it never exceeds 5 by checking intermediate states
  cleanup(userId);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- tests/sm2.test.js -t "caps interval"` 2>&1 | tail -10
Expected: FAIL — interval 会远大于 5

- [ ] **Step 3: 实现 — 在 `recordResult` 中添加上限**

在 `src/algorithms/sm2.js` 的 `recordResult` 函数中，找到计算 `interval` 的代码（第41-50行）：

```js
  if (correct) {
    if (repetitions === 0) interval = 1;
    else if (repetitions === 1) interval = hard ? 2 : 3;
    else interval = Math.round(interval * efactor * (hard ? 0.8 : 1));
    repetitions += 1;
  } else {
    repetitions = 0;
    interval = 0;
    efactor = Math.max(1.3, efactor - (hard ? 0.35 : 0.2));
  }
```

在 `}` 之后、`const nextReview = ...` 之前，添加：

```js
  // Cap interval for small vocabularies — no word disappears for more than 5 days
  const MAX_INTERVAL = 5;
  interval = Math.min(interval, MAX_INTERVAL);
```

完整修改后的 `recordResult` 函数中相关部分（第39-53行）应改为：

```js
  let { interval, efactor, repetitions } = review;

  if (correct) {
    if (repetitions === 0) interval = 1;
    else if (repetitions === 1) interval = hard ? 2 : 3;
    else interval = Math.round(interval * efactor * (hard ? 0.8 : 1));
    repetitions += 1;
  } else {
    repetitions = 0;
    interval = 0;
    efactor = Math.max(1.3, efactor - (hard ? 0.35 : 0.2));
  }

  // Cap interval for small vocabularies — no word disappears for more than 5 days
  const MAX_INTERVAL = 5;
  interval = Math.min(interval, MAX_INTERVAL);

  const nextReview = correct ? addDays(t, interval) : t;
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- tests/sm2.test.js 2>&1 | tail -15`
Expected: All 8 tests pass (7 existing + 1 new)

- [ ] **Step 5: Commit**

```bash
git add src/algorithms/sm2.js tests/sm2.test.js
git commit -m "feat: cap SM2 interval at 5 days for small vocabulary"
```

---

### Task 3: 同日去重 — 一天内同一词只按最后一次答题更新 SM2

**Files:**
- Modify: `src/algorithms/sm2.js` — `recordResult` 函数
- Test: `tests/sm2.test.js` — 新增 `describe('same-day dedup', ...)` 块

**Purpose:** 同一天内同一词被抽2遍（认读+拼写），SM2 只按最后一次结果更新，避免间隔在一天内连续增长。

**机制：** 用 `pre_today_state` 列存储今天第一次复习前的状态。当天第二次及以后的复习时，先恢复到 `pre_today_state`，再重新计算。

- [ ] **Step 1: 写测试**

在 `tests/sm2.test.js` 中添加新的 describe 块：

```js
describe('same-day dedup', () => {
  it('second correct on same day does not grow interval further', () => {
    const { userId, wordId } = setupUserWord('sm2_sd1', 'sd1', '同日1');
    initSm2Review(userId, wordId);
    // First review: interval 0 → 1
    recordResult(userId, wordId, true);
    let state = db.prepare('SELECT * FROM sm2_reviews WHERE user_id = ? AND word_id = ?').get(userId, wordId);
    expect(state.interval).toBe(1);

    // Second review same day (correct again): should still be interval 1
    // (re-computed from pre-today state, not from interval=1)
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
    // Pre-today was interval=0, repetitions=0 → wrong → interval=0, repetitions=0
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- tests/sm2.test.js -t "same-day"` 2>&1 | tail -10
Expected: FAIL — 第二次答题会叠加更新

- [ ] **Step 3: 实现 — 修改 `recordResult`**

在 `src/algorithms/sm2.js` 的 `recordResult` 函数中，修改逻辑如下。

找到这一段（第20-37行，函数的主体部分）：

```js
export function recordResult(userId, wordId, correct, hard = false) {
  const t = today();
  const review = db.prepare(
    'SELECT * FROM sm2_reviews WHERE user_id = ? AND word_id = ?'
  ).get(userId, wordId);

  if (!review) {
    if (hard) {
      db.prepare(`
        INSERT INTO sm2_reviews (user_id, word_id, interval, efactor, repetitions, next_review)
        VALUES (?, ?, 0, 2.2, 0, ?)
        ON CONFLICT(user_id, word_id) DO NOTHING
      `).run(userId, wordId, t);
    } else {
      initSm2Review(userId, wordId);
    }
    return recordResult(userId, wordId, correct, hard);
  }

  let { interval, efactor, repetitions } = review;
```

将其替换为：

```js
export function recordResult(userId, wordId, correct, hard = false) {
  const t = today();
  const review = db.prepare(
    'SELECT * FROM sm2_reviews WHERE user_id = ? AND word_id = ?'
  ).get(userId, wordId);

  if (!review) {
    if (hard) {
      db.prepare(`
        INSERT INTO sm2_reviews (user_id, word_id, interval, efactor, repetitions, next_review)
        VALUES (?, ?, 0, 2.2, 0, ?)
        ON CONFLICT(user_id, word_id) DO NOTHING
      `).run(userId, wordId, t);
    } else {
      initSm2Review(userId, wordId);
    }
    return recordResult(userId, wordId, correct, hard);
  }

  let { interval, efactor, repetitions } = review;

  // Same-day dedup: if already reviewed today, restore pre-today state
  if (review.last_review === t) {
    if (review.pre_today_state) {
      const prev = JSON.parse(review.pre_today_state);
      interval = prev.interval;
      efactor = prev.efactor;
      repetitions = prev.repetitions;
    }
    // else: first review already happened today but pre_today_state wasn't saved
    // (e.g. from before migration) — use current state as-is (fallback)
  } else {
    // First review today: save current state as pre_today_state
    db.prepare(`
      UPDATE sm2_reviews SET pre_today_state = ?
      WHERE user_id = ? AND word_id = ?
    `).run(JSON.stringify({ interval, efactor, repetitions }), userId, wordId);
  }
```

注意：MAX_INTERVAL cap（Task 2 添加的）保持不变，仍在 interval 计算之后。

完整的 `recordResult` 函数最终应如下：

```js
export function recordResult(userId, wordId, correct, hard = false) {
  const t = today();
  const review = db.prepare(
    'SELECT * FROM sm2_reviews WHERE user_id = ? AND word_id = ?'
  ).get(userId, wordId);

  if (!review) {
    if (hard) {
      db.prepare(`
        INSERT INTO sm2_reviews (user_id, word_id, interval, efactor, repetitions, next_review)
        VALUES (?, ?, 0, 2.2, 0, ?)
        ON CONFLICT(user_id, word_id) DO NOTHING
      `).run(userId, wordId, t);
    } else {
      initSm2Review(userId, wordId);
    }
    return recordResult(userId, wordId, correct, hard);
  }

  let { interval, efactor, repetitions } = review;

  // Same-day dedup: if already reviewed today, restore pre-today state
  if (review.last_review === t) {
    if (review.pre_today_state) {
      const prev = JSON.parse(review.pre_today_state);
      interval = prev.interval;
      efactor = prev.efactor;
      repetitions = prev.repetitions;
    }
  } else {
    // First review today: save current state as pre_today_state
    db.prepare(`
      UPDATE sm2_reviews SET pre_today_state = ?
      WHERE user_id = ? AND word_id = ?
    `).run(JSON.stringify({ interval, efactor, repetitions }), userId, wordId);
  }

  if (correct) {
    if (repetitions === 0) interval = 1;
    else if (repetitions === 1) interval = hard ? 2 : 3;
    else interval = Math.round(interval * efactor * (hard ? 0.8 : 1));
    repetitions += 1;
  } else {
    repetitions = 0;
    interval = 0;
    efactor = Math.max(1.3, efactor - (hard ? 0.35 : 0.2));
  }

  // Cap interval for small vocabularies
  const MAX_INTERVAL = 5;
  interval = Math.min(interval, MAX_INTERVAL);

  const nextReview = correct ? addDays(t, interval) : t;

  db.prepare(`
    UPDATE sm2_reviews
    SET interval = ?, efactor = ?, repetitions = ?, next_review = ?, last_review = ?
    WHERE user_id = ? AND word_id = ?
  `).run(interval, efactor, repetitions, nextReview, t, userId, wordId);

  return { interval, efactor, repetitions, next_review: nextReview, last_review: t };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- tests/sm2.test.js 2>&1 | tail -15`
Expected: All 10 tests pass (7 existing + 1 max interval + 3 same-day dedup)

- [ ] **Step 5: Commit**

```bash
git add src/algorithms/sm2.js tests/sm2.test.js
git commit -m "feat: same-day dedup for SM2 reviews using pre_today_state"
```

---

### Task 4: 加权随机填充 — 打破"总是同一批词"的死循环

**Files:**
- Modify: `src/algorithms/sm2.js` — `getDueWords` 函数
- Test: `test/quiz.test.js` — 在 `GET /api/quiz/today` describe 块中添加

**Purpose:** 当前 extraWords 按 `next_review ASC` 排序取最早到期的，导致同一批词每天出现。改为加权随机，越近的权重越高但有随机性，让所有词都能轮转到。

**算法：**
1. 查出所有未到期候选词
2. 给每个候选词分配权重：`weight = 1 / (daysUntilReview + 1)` （越近权重越高，+1 防止除零）
3. 加权随机抽样：计算累计权重，生成随机数，取累计权重跨越随机数的词
4. 重复抽取直到达到所需数量

- [ ] **Step 1: 写测试**

在 `test/quiz.test.js` 的 `describe('GET /api/quiz/today', ...)` 块中添加：

```js
it('extra fill should vary words across days (weighted random)', async () => {
  // Create 20 words, all with sm2_reviews, none due today
  const today = new Date().toISOString().slice(0, 10);
  const future = new Date(Date.now() + 86400000 * 3).toISOString().slice(0, 10); // 3 days from now
  const wordIds = [];
  for (let i = 0; i < 20; i++) {
    const w = addWord(`rand${i}`, `随机${i}`, '2026-01-01');
    db.prepare(`
      INSERT INTO sm2_reviews (user_id, word_id, interval, efactor, repetitions, next_review)
      VALUES (1, ?, 3, 2.5, 2, ?)
    `).run(w.lastInsertRowid, future);
    wordIds.push(w.lastInsertRowid);
  }

  // Fetch today's quiz 3 times, collect word sets
  const wordSets = [];
  for (let i = 0; i < 3; i++) {
    const res = await request(testApp).get('/api/quiz/today');
    expect(res.status).toBe(200);
    wordSets.push(new Set(res.body.words.map(w => w.english)));
  }

  // All 3 sessions should have 20 words (dailyLimit = 20% of 20 = 4... wait, need more words)
  // Actually, dailyLimit = ceil(20 * 20/100) = 4 words. We need enough words.
  // Let's use 50 words so dailyLimit = ceil(50 * 0.3) = 15 (using default 30% ratio)
});
```

Wait, the test app uses user_id=1 and the default limit calculation. Let me re-check.

Looking at the existing tests, `dailyLimit` is calculated by `getUserQuizLimit` which uses `user_preferences`. If no preferences exist, it defaults to `ratio=20` (20%). With 20 words, limit = ceil(20 * 0.2) = 4.

I need to adjust the test to ensure enough words are in the extra pool. Let me rewrite:

```js
it('extra fill should vary words across days (weighted random)', async () => {
  // Create 50 words, all with sm2_reviews, none due today
  // dailyLimit = ceil(50 * 0.20) = 10 words
  const future = new Date(Date.now() + 86400000 * 3).toISOString().slice(0, 10);
  for (let i = 0; i < 50; i++) {
    const w = addWord(`rand${i}`, `随机${i}`, '2026-01-01');
    db.prepare(`
      INSERT INTO sm2_reviews (user_id, word_id, interval, efactor, repetitions, next_review)
      VALUES (1, ?, 3, 2.5, 2, ?)
    `).run(w.lastInsertRowid, future);
  }

  // Fetch today's quiz multiple times, collect unique words seen
  const allWords = new Set();
  for (let i = 0; i < 5; i++) {
    const res = await request(testApp).get('/api/quiz/today');
    expect(res.status).toBe(200);
    res.body.words.forEach(w => allWords.add(w.english));
    // Clear session so next call generates new words
    db.exec("DELETE FROM quiz_session");
  }

  // With weighted random, across 5 sessions of 10 words each (50 total picks),
  // we should see significantly more than 10 unique words out of 50
  // With pure ASC ordering, we'd only see the same 10 words every time
  expect(allWords.size).toBeGreaterThan(15);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- test/quiz.test.js -t "weighted random"` 2>&1 | tail -10
Expected: FAIL — with ASC ordering, same 10 words every time, allWords.size = 10

- [ ] **Step 3: 实现 — 修改 `getDueWords` 中的 extraWords 逻辑**

在 `src/algorithms/sm2.js` 中，找到 extraWords 查询（约第100-121行）。替换为 JavaScript 加权随机实现。

将以下代码段（第99-121行）：

```js
  // If still under dailyLimit, fill with earliest upcoming reviews
  const fetched = dueWords.length + newWords.length;
  const remaining = Math.max(0, dailyLimit - fetched);
  const existingIds = fetched > 0 ? [...dueWords, ...newWords].map(w => w.id) : [];
  const extraWords = extra > 0 && existingIds.length > 0 ? db.prepare(`
    SELECT w.*, s.interval, s.efactor, s.repetitions, s.next_review,
           CASE WHEN s.last_review IS NULL OR s.repetitions = 0 THEN 1 ELSE 0 END as is_wrong
    FROM words w
    JOIN sm2_reviews s ON w.id = s.word_id AND w.user_id = s.user_id
    WHERE s.user_id = ?
      AND s.next_review > ?
      AND w.id NOT IN (${existingIds.join(',')})
    ORDER BY s.next_review ASC
    LIMIT ?
  `).all(userId, t, extra) : extra > 0 ? db.prepare(`
    SELECT w.*, s.interval, s.efactor, s.repetitions, s.next_review,
           CASE WHEN s.last_review IS NULL OR s.repetitions = 0 THEN 1 ELSE 0 END as is_wrong
    FROM words w
    JOIN sm2_reviews s ON w.id = s.word_id AND w.user_id = s.user_id
    WHERE s.user_id = ? AND s.next_review > ?
    ORDER BY s.next_review ASC
    LIMIT ?
  `).all(userId, t, extra) : [];
```

替换为：

```js
  // If still under dailyLimit, fill with weighted random from upcoming reviews
  const fetched = dueWords.length + newWords.length;
  const remaining = Math.max(0, dailyLimit - fetched);
  const existingIds = fetched > 0 ? [...dueWords, ...newWords].map(w => w.id) : [];
  const placeholder = existingIds.length > 0 ? `AND w.id NOT IN (${existingIds.join(',')})` : '';

  const candidates = remaining > 0 ? db.prepare(`
    SELECT w.*, s.interval, s.efactor, s.repetitions, s.next_review,
           CASE WHEN s.last_review IS NULL OR s.repetitions = 0 THEN 1 ELSE 0 END as is_wrong,
           CAST(julianday(s.next_review) - julianday(?) AS INTEGER) as days_until
    FROM words w
    JOIN sm2_reviews s ON w.id = s.word_id AND w.user_id = s.user_id
    WHERE s.user_id = ? AND s.next_review > ? ${placeholder}
  `).all(t, userId, t) : [];

  const extraWords = weightedRandomSample(candidates, remaining);
```

在 `src/algorithms/sm2.js` 文件顶部（`const today = ...` 之后）添加加权随机函数：

```js
/**
 * Weighted random sample: picks `count` items where weight = 1 / (daysUntil + 1).
 * Closer reviews have higher chance but all have a shot.
 */
function weightedRandomSample(candidates, count) {
  if (candidates.length <= count) return candidates;

  // Assign weights: closer = higher weight
  const weighted = candidates.map(c => ({
    ...c,
    weight: 1 / (Math.max(0, c.days_until) + 1),
  }));

  const selected = [];
  const remaining = [...weighted];

  for (let i = 0; i < count; i++) {
    const totalWeight = remaining.reduce((sum, c) => sum + c.weight, 0);
    let rand = Math.random() * totalWeight;
    let chosenIndex = 0;

    for (let j = 0; j < remaining.length; j++) {
      rand -= remaining[j].weight;
      if (rand <= 0) {
        chosenIndex = j;
        break;
      }
    }

    const chosen = remaining[chosenIndex];
    // Remove weight-related fields from output
    const { weight, days_until, ...clean } = chosen;
    selected.push(clean);
    remaining.splice(chosenIndex, 1);
  }

  return selected;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- test/quiz.test.js 2>&1 | tail -20`
Expected: quiz tests pass, including the new weighted random test

- [ ] **Step 5: Commit**

```bash
git add src/algorithms/sm2.js test/quiz.test.js
git commit -m "feat: weighted random fill for extra quiz words"
```

---

### Task 5: 更新现有 SM2 测试期望值 + 全量回归

**Files:**
- Modify: `tests/sm2.test.js`
- Modify: `test/quiz.test.js`
- Modify: `tests/quiz-sm2.test.js`（如有需要）

**Purpose:** 现有测试中某些期望值（如 `interval = 8` 在第3次答对时）需要更新为 `Math.min(8, 5) = 5`。确保所有测试通过。

- [ ] **Step 1: 更新 `tests/sm2.test.js` 中第三个 correct 测试**

找到这段代码（第56-66行）：

```js
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
```

将 `expect(state.interval).toBe(8)` 改为 `expect(state.interval).toBe(5)`，注释也改为：

```js
  expect(state.interval).toBe(5); // Math.min(Math.round(3 * 2.5), 5) = 5
```

- [ ] **Step 2: 检查 `test/quiz.test.js` 中是否有 interval 期望值需要更新**

在 `test/quiz.test.js` 中找到第165行：
```js
expect(state.interval).toBe(1);
```

这不受影响（interval=1 < 5），无需修改。

- [ ] **Step 3: 运行全部测试**

Run: `npm test 2>&1 | tail -30`
Expected: SM2-related tests all pass. Pre-existing failures (words.test.js FK constraint) are unrelated to these changes.

Specifically verify:
- `tests/sm2.test.js`: all 10 tests pass
- `test/quiz.test.js`: quiz tests pass (SM2-related ones)
- `tests/quiz-sm2.test.js`: auth tests pass

- [ ] **Step 4: Commit**

```bash
git add tests/sm2.test.js test/quiz.test.js
git commit -m "test: update SM2 test expectations for 5-day interval cap"
```

---

### Task 6: 修复生产数据库 — 重置已膨胀的间隔

**Files:**
- 不涉及代码变更，仅数据库操作

**Purpose:** 生产数据库中已有72个词的间隔 > 30天。代码部署后，这些词仍不会在下次抽查时出现（因为 next_review 在未来）。需要将这些词的间隔重置为合理值。

- [ ] **Step 1: 重置所有 interval > 5 的词**

Run:
```bash
sqlite3 data/words.db "
UPDATE sm2_reviews SET interval = 0, repetitions = 0, next_review = date('now')
WHERE interval > 5;
"
```

这会将所有间隔膨胀的词重置为"待复习"状态，下次抽查时它们会重新出现。

Expected output: `SQLite` 显示受影响行数（约72行）。

- [ ] **Step 2: 验证重置效果**

Run:
```bash
sqlite3 data/words.db "
SELECT COUNT(*) as reset_count FROM sm2_reviews WHERE interval <= 5 AND user_id = 9;
SELECT COUNT(*) as due_today FROM sm2_reviews WHERE next_review <= date('now') AND user_id = 9;
"
```

Expected: reset_count = 99（所有词的 interval ≤ 5），due_today = 约72（被重置的词）

- [ ] **Step 3: Commit（无需代码变更，仅验证）**

无需 commit，这是生产数据修复。

---

## 文件变更总结

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/db.js` | 修改 | 添加 `pre_today_state` 列迁移 |
| `src/algorithms/sm2.js` | 修改 | 3项改动：interval cap、same-day dedup、weighted random |
| `tests/sm2.test.js` | 修改 | 更新期望值 + 新增4个测试 |
| `test/quiz.test.js` | 修改 | 新增加权随机测试 |
| `data/words.db` | 数据修复 | 重置已膨胀间隔 |

## 风险与注意事项

1. **`ALTER TABLE` 幂等性**：用 try/catch 处理已存在列的情况
2. **`pre_today_state` JSON 解析**：对旧数据（无此列或 NULL）做了 fallback，不影响
3. **加权随机的可测试性**：测试用多次采样的唯一词数来验证随机性，非确定性断言
4. **向后兼容**：`quizStrategy.js` 的接口不变，`recordResult(userId, wordId, correct, hard)` 签名不变
