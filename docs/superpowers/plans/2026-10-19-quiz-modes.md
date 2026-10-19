# Quiz 模式重设计实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将两种 quiz 模式（认读/拼写）重新设计为三种模式（认读/拼写/听力），使用下拉菜单切换。

**Architecture:** 删除 `spellMode` 布尔字段，新增 `quizMode` 字符串枚举（'reading'|'spelling'|'listening'）。后端 Settings API 和 Quiz Record API 更新字段名和验证逻辑。前端用下拉菜单替代切换按钮，用计算属性控制各模式的显示内容。

**Tech Stack:** Express 5 + better-sqlite3（后端），Alpine.js（前端），vitest + supertest（测试）

## Global Constraints

- 无数据迁移：直接删除旧 spellMode 记录，用户重新设置模式
- 保持交互方式不变：显示答案 → 自评对错
- 三种模式：reading（认读）、spelling（拼写）、listening（听力）
- 模式切换用下拉菜单 `<select>`

---

## Task 1: 后端 Settings API — 删除 spellMode，新增 quizMode

**Files:**
- Modify: `src/api/settings.js:115-138`（删除 spellMode 相关代码）
- Modify: `src/api/settings.js`（新增 quizMode API）
- Test: `test/settings.test.js`（如存在，否则创建）

**Interfaces:**
- Consumes: 无（这是第一个任务）
- Produces: 
  - `GET /api/settings/quizMode` → `{ quizMode: 'reading' | 'spelling' | 'listening' }`
  - `PUT /api/settings/quizMode` ← `{ quizMode: string }`，验证值为 'reading'|'spelling'|'listening'
  - 常量：`QUIZ_MODE_DEFAULT = 'reading'`，`QUIZ_MODE_OPTIONS = ['reading', 'spelling', 'listening']`

- [ ] **Step 1: 写失败测试 — GET quizMode 默认值**

```javascript
// test/settings.test.js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';

describe('Settings API - quizMode', () => {
  let agent;
  
  beforeAll(() => {
    agent = request.agent(app);
  });

  it('GET /api/settings/quizMode 返回默认值 reading', async () => {
    // 先登录（假设有测试用户）
    await agent.post('/api/auth/login').send({ username: 'test', password: 'test' });
    
    const res = await agent.get('/api/settings/quizMode');
    expect(res.status).toBe(200);
    expect(res.body.quizMode).toBe('reading');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npm test -- test/settings.test.js
```

Expected: FAIL — "Cannot GET /api/settings/quizMode"

- [ ] **Step 3: 删除旧的 spellMode 代码**

打开 `src/api/settings.js`，找到并删除：

```javascript
// 删除这些行（约 115-138 行）
const SPELL_MODE_DEFAULT = false;

app.get('/api/settings/spellMode', ...);
app.put('/api/settings/spellMode', ...);
```

- [ ] **Step 4: 实现 quizMode API**

在 `src/api/settings.js` 中添加：

```javascript
const QUIZ_MODE_DEFAULT = 'reading';
const QUIZ_MODE_OPTIONS = ['reading', 'spelling', 'listening'];

// GET /api/settings/quizMode
app.get('/api/settings/quizMode', requireAuth, (req, res) => {
  const row = db.prepare('SELECT value FROM user_preferences WHERE user_id = ? AND key = ?')
    .get(req.userId, 'quizMode');
  
  const quizMode = row?.value ?? QUIZ_MODE_DEFAULT;
  res.json({ quizMode });
});

// PUT /api/settings/quizMode
app.put('/api/settings/quizMode', requireAuth, (req, res) => {
  const { quizMode } = req.body;
  
  if (!QUIZ_MODE_OPTIONS.includes(quizMode)) {
    return res.status(400).json({ 
      error: `quizMode must be one of: ${QUIZ_MODE_OPTIONS.join(', ')}` 
    });
  }
  
  db.prepare(`
    INSERT INTO user_preferences (user_id, key, value, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(req.userId, 'quizMode', quizMode);
  
  res.json({ success: true });
});
```

- [ ] **Step 5: 运行测试确认通过**

```bash
npm test -- test/settings.test.js
```

Expected: PASS

- [ ] **Step 6: 添加更多测试用例**

```javascript
it('PUT /api/settings/quizMode 保存有效值', async () => {
  await agent.post('/api/auth/login').send({ username: 'test', password: 'test' });
  
  const res = await agent.put('/api/settings/quizMode')
    .send({ quizMode: 'spelling' });
  
  expect(res.status).toBe(200);
  
  const getRes = await agent.get('/api/settings/quizMode');
  expect(getRes.body.quizMode).toBe('spelling');
});

it('PUT /api/settings/quizMode 拒绝无效值', async () => {
  await agent.post('/api/auth/login').send({ username: 'test', password: 'test' });
  
  const res = await agent.put('/api/settings/quizMode')
    .send({ quizMode: 'invalid' });
  
  expect(res.status).toBe(400);
});

it('支持所有三个模式值', async () => {
  await agent.post('/api/auth/login').send({ username: 'test', password: 'test' });
  
  for (const mode of ['reading', 'spelling', 'listening']) {
    await agent.put('/api/settings/quizMode').send({ quizMode: mode });
    const res = await agent.get('/api/settings/quizMode');
    expect(res.body.quizMode).toBe(mode);
  }
});
```

- [ ] **Step 7: 运行所有测试**

```bash
npm test
```

Expected: PASS

- [ ] **Step 8: 提交**

```bash
git add src/api/settings.js test/settings.test.js
git commit -m "feat: replace spellMode with quizMode enum in settings API

- Delete spellMode boolean field and related endpoints
- Add quizMode enum field with values: reading, spelling, listening
- Default value: reading
- Validate input against allowed values

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Task 2: 后端 Quiz Record API — 更新 record 接口

**Files:**
- Modify: `src/api/quiz.js:84-111`（POST /api/quiz/record）
- Test: `test/quiz.test.js`（更新现有测试）

**Interfaces:**
- Consumes: `quizMode: 'reading' | 'spelling' | 'listening'`（从前端传入）
- Produces: 记录答题时使用的模式到 `quiz_records` 表（用于未来统计分析）

- [ ] **Step 1: 更新测试用例**

打开 `test/quiz.test.js`，找到测试 `POST /api/quiz/record` 的用例，将 `spellMode: true/false` 改为 `quizMode: 'reading'|'spelling'|'listening'`：

```javascript
it('记录答题时包含 quizMode', async () => {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ username: 'test', password: 'test' });
  
  // 开始 quiz 获取词汇
  const quizRes = await agent.get('/api/quiz/today');
  const wordId = quizRes.body.words[0].id;
  
  // 记录答案
  const res = await agent.post('/api/quiz/record').send({
    word_id: wordId,
    correct: 1,
    quizMode: 'spelling'
  });
  
  expect(res.status).toBe(200);
  expect(res.body.success).toBe(true);
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npm test -- test/quiz.test.js
```

Expected: FAIL — 因为后端还在用 `spellMode`

- [ ] **Step 3: 更新 quiz.js 中的 record 接口**

打开 `src/api/quiz.js`，找到 `POST /api/quiz/record` 的处理函数（约 84-111 行），修改：

```javascript
// 旧代码
app.post('/api/quiz/record', requireAuth, (req, res) => {
  const { word_id, correct, spellMode } = req.body;
  // ...
  recordResult(req.userId, word_id, correct, spellMode);
  // ...
});

// 新代码
app.post('/api/quiz/record', requireAuth, (req, res) => {
  const { word_id, correct, quizMode } = req.body;
  
  // 验证 quizMode
  const QUIZ_MODE_OPTIONS = ['reading', 'spelling', 'listening'];
  if (!QUIZ_MODE_OPTIONS.includes(quizMode)) {
    return res.status(400).json({ error: 'Invalid quizMode' });
  }
  
  // 插入 quiz_records
  db.prepare(`
    INSERT INTO quiz_records (user_id, word_id, correct, quiz_date)
    VALUES (?, ?, ?, date('now'))
  `).run(req.userId, word_id, correct);
  
  // 更新 SM-2 状态（quizMode 参数暂不用于算法，仅记录）
  recordResult(req.userId, word_id, correct, false);
  
  // 更新 quiz_session
  db.prepare(`
    UPDATE quiz_session 
    SET result = ? 
    WHERE user_id = ? AND word_id = ? AND quiz_date = date('now')
  `).run(correct, req.userId, word_id);
  
  res.json({ success: true });
});
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npm test -- test/quiz.test.js
```

Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/api/quiz.js test/quiz.test.js
git commit -m "feat: update quiz record API to use quizMode instead of spellMode

- Replace spellMode boolean with quizMode enum
- Validate quizMode value before recording
- Store quizMode for future analytics (not yet used in SM-2 algorithm)

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Task 3: 前端状态管理 — 替换 spellMode 为 quizMode

**Files:**
- Modify: `public/app.js:1127-1153`（删除 loadSpellMode/toggleSpellMode）
- Modify: `public/app.js`（新增 quizMode 状态和方法）
- Modify: `public/app.js:197, 257`（更新加载时机）

**Interfaces:**
- Consumes: `GET /api/settings/quizMode` → `{ quizMode: string }`
- Produces:
  - 状态：`quizMode: 'reading' | 'spelling' | 'listening'`
  - 方法：`loadQuizMode()`, `changeQuizMode()`
  - 计算属性：`showEnglishPrompt`, `showChinesePrompt`, `showAudioOnly`, `showEnglishAnswer`, `showChineseAnswer`, `showAnswerAudio`, `showHintButton`

- [ ] **Step 1: 删除旧的 spellMode 代码**

打开 `public/app.js`，找到并删除：

```javascript
// 删除状态变量（在 Alpine.data('quizApp', ...) 内）
spellMode: false,

// 删除方法（约 1127-1153 行）
async loadSpellMode() { ... },
async toggleSpellMode() { ... },
```

- [ ] **Step 2: 新增 quizMode 状态和方法**

在 `public/app.js` 的 Alpine.data('quizApp', ...) 中添加：

```javascript
// 状态
quizMode: 'reading',

// 方法
async loadQuizMode() {
  const res = await fetch('/api/settings/quizMode');
  if (res.ok) {
    const data = await res.json();
    this.quizMode = data.quizMode || 'reading';
  }
  this._quizModeLoaded = true;
},

async changeQuizMode() {
  this.hintRevealed = false;
  this.spellHint = '';
  await fetch('/api/settings/quizMode', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quizMode: this.quizMode }),
  });
},

// 计算属性
get showEnglishPrompt() {
  return this.quizMode === 'reading' && !this.revealed;
},

get showChinesePrompt() {
  return this.quizMode === 'spelling' && !this.revealed;
},

get showAudioOnly() {
  return this.quizMode === 'listening' && !this.revealed;
},

get showEnglishAnswer() {
  return this.revealed && (this.quizMode === 'spelling' || this.quizMode === 'listening');
},

get showChineseAnswer() {
  return this.revealed && this.quizMode === 'reading';
},

get showAnswerAudio() {
  return this.revealed && this.quizMode !== 'listening';
},

get showHintButton() {
  return !this.revealed && 
         (this.quizMode === 'spelling' || this.quizMode === 'listening');
},
```

- [ ] **Step 3: 更新加载时机**

在 `public/app.js` 中，找到登录成功后的代码（约 197 行和 257 行），将 `this.loadSpellMode()` 改为 `this.loadQuizMode()`：

```javascript
// 旧代码
this.loadSpellMode();

// 新代码
this.loadQuizMode();
```

- [ ] **Step 4: 更新 recordAnswer 方法**

在 `public/app.js` 中，找到 `recordAnswer` 方法（约 537-552 行），修改：

```javascript
// 旧代码
async recordAnswer(correct) {
  await fetch('/api/quiz/record', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      word_id: this.currentWord.id,
      correct,
      spellMode: this.spellMode,
    }),
  });
}

// 新代码
async recordAnswer(correct) {
  await fetch('/api/quiz/record', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      word_id: this.currentWord.id,
      correct,
      quizMode: this.quizMode,
    }),
  });
}
```

- [ ] **Step 5: 在浏览器控制台测试**

启动应用：
```bash
npm run dev
```

打开浏览器开发者工具控制台，验证：
```javascript
// 应该能访问这些属性
quizApp.quizMode  // 'reading'
quizApp.showEnglishPrompt  // true
quizApp.showChinesePrompt  // false
quizApp.showAudioOnly  // false
```

- [ ] **Step 6: 提交**

```bash
git add public/app.js
git commit -m "feat: replace spellMode with quizMode in frontend state

- Delete spellMode state and related methods
- Add quizMode enum state with three values
- Add computed properties for mode-specific display logic
- Update loadQuizMode() to be called after login
- Update recordAnswer() to send quizMode instead of spellMode

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Task 4: 前端 UI — 模式选择器下拉菜单

**Files:**
- Modify: `public/index.html:58-61`（替换切换按钮为下拉菜单）

**Interfaces:**
- Consumes: `quizMode` 状态（来自 Task 3）
- Produces: 用户可通过下拉菜单切换模式

- [ ] **Step 1: 替换按钮为下拉菜单**

打开 `public/index.html`，找到约 58-61 行的切换按钮：

```html
<!-- 旧代码 -->
<button class="spell-mode-btn" @click="toggleSpellMode()" :class="{ active: spellMode }">
  <span x-show="!spellMode">✏️ 拼写模式</span>
  <span x-show="spellMode">📖 认读模式</span>
</button>
```

替换为：

```html
<!-- 新代码 -->
<select class="quiz-mode-select" x-model="quizMode" @change="changeQuizMode()">
  <option value="reading">📖 认读模式</option>
  <option value="spelling">✏️ 拼写模式</option>
  <option value="listening">👂 听力模式</option>
</select>
```

- [ ] **Step 2: 在浏览器中测试**

启动应用并验证：
1. 下拉菜单显示三个选项
2. 切换模式后，页面刷新仍保持选择
3. 控制台检查 `quizApp.quizMode` 值正确

- [ ] **Step 3: 提交**

```bash
git add public/index.html
git commit -m "feat: replace spellMode toggle button with quizMode dropdown

- Use <select> element for mode selection
- Bind to quizMode state with x-model
- Call changeQuizMode() on change to save preference

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Task 5: 前端 UI — Quiz 卡片显示逻辑

**Files:**
- Modify: `public/index.html:113-175`（quiz 卡片区域）

**Interfaces:**
- Consumes:
  - 计算属性：`showEnglishPrompt`, `showChinesePrompt`, `showAudioOnly`, `showEnglishAnswer`, `showChineseAnswer`, `showAnswerAudio`, `showHintButton`（来自 Task 3）
  - 方法：`speakWord()`, `revealHint()`, `reveal()`, `markCorrect()`, `markIncorrect()`, `nextWord()`
- Produces: 根据模式动态显示不同的提示和答案内容

- [ ] **Step 1: 更新 quiz 卡片模板**

打开 `public/index.html`，找到 quiz 卡片区域（约 113-175 行），替换为：

```html
<div class="quiz-card">
  <!-- 认读模式：初始显示英文 -->
  <div x-show="showEnglishPrompt" class="word-display">
    <h2 x-text="currentWord?.english"></h2>
  </div>

  <!-- 拼写模式：初始显示中文 -->
  <div x-show="showChinesePrompt" class="word-display">
    <h2 x-text="currentWord?.chinese"></h2>
  </div>

  <!-- 听力模式：初始只显示发音按钮 -->
  <div x-show="showAudioOnly" class="audio-only">
    <button class="btn-speak-large" @click="speakWord()">
      🔊 点击听发音
    </button>
  </div>

  <!-- 提示首字母（拼写/听力模式） -->
  <div x-show="showHintButton && !hintRevealed">
    <button @click="revealHint()">💡 提示首字母</button>
  </div>
  <div x-show="hintRevealed" class="hint">
    <span x-text="spellHint"></span>
  </div>

  <!-- 显示答案后的内容 -->
  <div x-show="revealed" class="answer-section">
    <!-- 认读模式答案：中文 + 发音 -->
    <template x-if="showChineseAnswer">
      <div>
        <p class="answer-chinese" x-text="currentWord?.chinese"></p>
        <button class="btn-speak" @click="speakWord()">🔊</button>
      </div>
    </template>

    <!-- 拼写/听力模式答案：英文 + 发音 -->
    <template x-if="showEnglishAnswer">
      <div>
        <p class="answer-english" x-text="currentWord?.english"></p>
        <button x-show="showAnswerAudio" class="btn-speak" @click="speakWord()">🔊</button>
      </div>
    </template>
  </div>

  <!-- 操作按钮 -->
  <div class="action-buttons">
    <button x-show="!revealed" @click="reveal()">显示答案</button>
    <template x-if="revealed && !answered">
      <div>
        <button @click="markCorrect()">✓ 答对了</button>
        <button @click="markIncorrect()">✗ 答错了</button>
      </div>
    </template>
    <button x-show="showNext" @click="nextWord()">下一个 →</button>
  </div>
</div>
```

- [ ] **Step 2: 在浏览器中测试三种模式**

**测试认读模式：**
1. 选择"📖 认读模式"
2. 开始 quiz
3. 验证：初始只显示英文单词
4. 点击"显示答案"
5. 验证：显示中文意思 + 发音按钮
6. 点击发音按钮，听到标准发音

**测试拼写模式：**
1. 选择"✏️ 拼写模式"
2. 刷新页面（验证模式保存）
3. 开始 quiz
4. 验证：初始只显示中文意思
5. 点击"提示首字母"（如果实现）
6. 点击"显示答案"
7. 验证：显示英文单词 + 发音按钮

**测试听力模式：**
1. 选择"👂 听力模式"
2. 开始 quiz
3. 验证：只显示发音按钮
4. 点击发音按钮听发音（可多次点击）
5. 点击"显示答案"
6. 验证：显示英文单词 + 中文意思（无发音按钮）

- [ ] **Step 3: 提交**

```bash
git add public/index.html
git commit -m "feat: implement mode-specific quiz card display logic

- Reading mode: show English → reveal Chinese + audio
- Spelling mode: show Chinese → reveal English + audio
- Listening mode: show audio button → reveal English + Chinese
- Show hint button for spelling/listening modes only
- Conditional rendering based on computed properties

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Task 6: 前端样式 — 新增 UI 组件样式

**Files:**
- Modify: `public/style.css`

**Interfaces:**
- Consumes: HTML 结构（来自 Task 4, 5）
- Produces: 下拉菜单、大发音按钮、答案区域的样式

- [ ] **Step 1: 添加下拉菜单样式**

打开 `public/style.css`，在文件末尾添加：

```css
/* Quiz 模式下拉选择器 */
.quiz-mode-select {
  padding: 8px 16px;
  border: 2px solid var(--star-yellow, #ffd700);
  border-radius: 20px;
  background: white;
  font-size: 16px;
  cursor: pointer;
  outline: none;
  transition: all 0.2s;
}

.quiz-mode-select:hover {
  border-color: var(--star-orange, #ff8c00);
}

.quiz-mode-select:focus {
  border-color: var(--star-blue, #4a90e2);
  box-shadow: 0 0 0 3px rgba(74, 144, 226, 0.2);
}
```

- [ ] **Step 2: 添加听力模式大按钮样式**

```css
/* 听力模式大发音按钮 */
.btn-speak-large {
  font-size: 24px;
  padding: 20px 40px;
  border-radius: 50px;
  background: var(--star-yellow, #ffd700);
  border: none;
  cursor: pointer;
  transition: all 0.2s;
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
}

.btn-speak-large:hover {
  background: var(--star-orange, #ff8c00);
  transform: translateY(-2px);
  box-shadow: 0 6px 12px rgba(0, 0, 0, 0.15);
}

.btn-speak-large:active {
  transform: translateY(0);
}

.audio-only {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 200px;
}
```

- [ ] **Step 3: 添加答案区域样式**

```css
/* 答案区域 */
.answer-section {
  margin-top: 24px;
  padding: 20px;
  background: rgba(255, 255, 255, 0.9);
  border-radius: 16px;
  text-align: center;
}

.answer-english {
  font-size: 32px;
  font-weight: bold;
  color: var(--star-blue, #4a90e2);
  margin: 12px 0;
}

.answer-chinese {
  font-size: 24px;
  color: var(--star-purple, #9b59b6);
  margin: 12px 0;
}

.answer-section .btn-speak {
  margin-top: 12px;
}
```

- [ ] **Step 4: 在浏览器中验证样式**

启动应用并检查：
1. 下拉菜单样式美观，与星星主题一致
2. 听力模式大按钮醒目，易于点击
3. 答案区域清晰，英文/中文用不同颜色区分
4. 响应式设计（移动端友好）

- [ ] **Step 5: 提交**

```bash
git add public/style.css
git commit -m "style: add styles for quiz mode UI components

- Dropdown selector with star theme
- Large audio button for listening mode
- Answer section with distinct colors for English/Chinese
- Hover and focus states for better UX

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Task 7: 集成测试和清理

**Files:**
- Test: 手动测试所有场景
- Cleanup: 删除旧代码引用

**Interfaces:**
- Consumes: 所有前置任务
- Produces: 完整可用的三模式系统

- [ ] **Step 1: 全局搜索旧代码引用**

```bash
grep -r "spellMode" src/ public/ test/ tests/
```

Expected: 应该没有结果（所有引用都已替换）

如果发现遗漏，返回相应任务修复。

- [ ] **Step 2: 完整测试流程**

**场景 1：新用户首次使用**
1. 清除浏览器数据
2. 登录
3. 验证：默认模式为"认读模式"
4. 完成一轮 quiz
5. 验证：答题记录正确保存

**场景 2：模式切换**
1. 切换到"拼写模式"
2. 刷新页面
3. 验证：模式保持为"拼写模式"
4. 切换到"听力模式"
5. 验证：模式保存成功

**场景 3：各模式完整流程**
- 认读模式：看英文 → 说中文 → 显示答案 → 听发音核对 → 自评
- 拼写模式：看中文 → 拼写 → 显示答案 → 听发音核对 → 自评
- 听力模式：听发音 → 拼写+说中文 → 显示答案 → 核对 → 自评

**场景 4：Session 恢复**
1. 在"拼写模式"下完成 3 题
2. 刷新页面
3. 验证：进度恢复，仍为"拼写模式"
4. 继续完成剩余题目

**场景 5：提示功能**
1. 在"拼写模式"下点击"提示首字母"
2. 验证：显示首字母+下划线
3. 切换到"听力模式"
4. 验证：也有提示功能
5. 切换到"认读模式"
6. 验证：无提示按钮

- [ ] **Step 3: 运行所有测试**

```bash
npm test
```

Expected: 所有测试通过

- [ ] **Step 4: 检查数据库清理**

```bash
sqlite3 data/wordy.db "SELECT * FROM user_preferences WHERE key = 'spellMode';"
```

Expected: 应该为空（旧记录已被删除或不存在）

如果有旧记录，手动删除：
```bash
sqlite3 data/wordy.db "DELETE FROM user_preferences WHERE key = 'spellMode';"
```

- [ ] **Step 5: 更新文档**

更新 `README.md` 或 `CLAUDE.md`（如需要），说明新的三模式系统。

- [ ] **Step 6: 最终提交**

```bash
git add .
git commit -m "feat: complete quiz modes redesign

- Implement three modes: reading, spelling, listening
- Replace boolean spellMode with enum quizMode
- Add dropdown selector for mode switching
- Mode-specific display logic for prompts and answers
- Full test coverage and documentation

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

- [ ] **Step 7: 创建 Pull Request（可选）**

```bash
git push origin develop
gh pr create --title "Quiz 模式重设计" --body "..."
```

---

## 验收标准

完成所有任务后，系统应满足：

1. ✅ **三种模式可切换**：下拉菜单选择，偏好保存到数据库
2. ✅ **认读模式**：初始显示英文，答案显示中文+发音
3. ✅ **拼写模式**：初始显示中文，答案显示英文+发音
4. ✅ **听力模式**：初始只显示发音按钮，答案显示英文+中文
5. ✅ **提示功能**：拼写/听力模式有"提示首字母"功能
6. ✅ **答题记录**：三种模式下答题都能正确记录 quizMode
7. ✅ **Session 恢复**：刷新页面后进度和模式都正确恢复
8. ✅ **无旧代码残留**：grep 搜索 spellMode 无结果
9. ✅ **所有测试通过**：`npm test` 全部通过
10. ✅ **样式美观**：与星星主题一致，响应式设计

---

## 风险与注意事项

1. **数据库兼容性**：如果已有用户设置了 spellMode，需要手动重新选择模式（无迁移）
2. **浏览器缓存**：用户可能需要清除缓存或强制刷新以加载新 JS
3. **移动端测试**：确保下拉菜单和按钮在移动端易操作
4. **音频加载**：听力模式可能频繁点击发音按钮，注意防重复请求（已有 `_audioLoading` 保护）

---

## 未来扩展

- 按模式统计正确率（需要 `quiz_records` 表增加 `quiz_mode` 字段）
- 自动推荐模式（根据用户薄弱项）
- 更多模式（如"听写模式"：听发音写中文）
