# Quiz 模式重设计

**日期**：2026-10-19  
**状态**：待实现

## 概述

将现有的两种模式（认读/拼写）重新设计为三种模式，更符合儿童学习英语的认知规律。

**现有问题**：当前模式定义与实际学习目标不匹配，用户反馈"模式反了"。

**新设计**：
1. **认读模式**：看英文 → 读单词 + 说中文
2. **拼写模式**：看中文 → 发音 + 拼写英文
3. **听力模式**：听发音 → 拼写英文 + 说中文

## 核心设计原则

1. **保持交互方式不变**：孩子完成任务 → 点击"显示答案"核对 → 自评对错
2. **模式切换用下拉菜单**：替代现有的双态切换按钮
3. **无数据迁移**：直接删除旧字段，用户重新设置模式

## 三个模式的详细流程

### 模式 1：认读模式（reading）

**学习目标**：看到英文单词能正确发音并理解意思

**流程**：
- **初始状态**：
  - 显示：英文单词（大字）
  - 隐藏：发音按钮、中文意思
- **孩子行为**：
  - 看英文单词
  - 自己大声读出
  - 说出中文意思
- **点击"显示答案"后**：
  - 显示：中文意思 + 发音按钮
- **核对**：
  - 点击发音按钮听标准发音
  - 对比自己刚才的发音和意思
- **自评**：答对/答错

### 模式 2：拼写模式（spelling）

**学习目标**：看到中文能正确拼写英文并发音

**流程**：
- **初始状态**：
  - 显示：中文意思（大字）
  - 隐藏：发音按钮、英文单词
- **孩子行为**：
  - 看中文意思
  - 口头拼写英文单词
- **点击"显示答案"后**：
  - 显示：英文单词 + 发音按钮
- **核对**：
  - 看正确拼写
  - 点击发音按钮听标准发音
- **自评**：答对/答错

**可选功能**：显示"提示首字母"按钮（显示首字母+下划线，如 `a____`）

### 模式 3：听力模式（listening）

**学习目标**：听发音能拼写英文并理解意思

**流程**：
- **初始状态**：
  - 显示：发音按钮（居中，大按钮）
  - 隐藏：英文单词、中文意思
  - 可重复点击播放
- **孩子行为**：
  - 点击发音按钮听单词
  - 可重复点击再听
  - 口头拼写英文单词
  - 说出中文意思
- **点击"显示答案"后**：
  - 显示：英文单词 + 中文意思
- **核对**：
  - 看正确拼写和意思
- **自评**：答对/答错

**可选功能**：显示"提示首字母"按钮

## 技术实现

### 数据库变更

**表**：`user_preferences`

**删除**：
- `key = 'spellMode'` 的记录

**新增**：
- `key = 'quizMode'`，`value` 为以下之一：
  - `'reading'` — 认读模式
  - `'spelling'` — 拼写模式
  - `'listening'` — 听力模式
- 默认值：`'reading'`

**无需数据迁移**：直接删除旧记录，用户首次使用时会重置为默认模式。

### 后端 API 变更

#### 1. Settings API（`src/api/settings.js`）

**删除**：
- `GET /api/settings/spellMode`
- `PUT /api/settings/spellMode`
- 相关常量：`SPELL_MODE_DEFAULT`

**新增**：
```javascript
const QUIZ_MODE_DEFAULT = 'reading';
const QUIZ_MODE_OPTIONS = ['reading', 'spelling', 'listening'];

// GET /api/settings/quizMode
// 返回：{ quizMode: 'reading' | 'spelling' | 'listening' }

// PUT /api/settings/quizMode
// 接收：{ quizMode: 'reading' | 'spelling' | 'listening' }
// 验证：必须在 QUIZ_MODE_OPTIONS 中
```

#### 2. Quiz Record API（`src/api/quiz.js`）

**变更**：`POST /api/quiz/record`

**旧请求体**：
```javascript
{
  word_id: number,
  correct: 0 | 1,
  spellMode: boolean  // 旧字段
}
```

**新请求体**：
```javascript
{
  word_id: number,
  correct: 0 | 1,
  quizMode: 'reading' | 'spelling' | 'listening'  // 新字段
}
```

**用途**：记录答题时的模式，用于未来统计分析（如各模式的正确率）。

### 前端变更

#### 1. 模式选择器 UI

**替换现有按钮**（`public/index.html:58-61`）：

```html
<!-- 旧代码 -->
<button class="spell-mode-btn" @click="toggleSpellMode()" :class="{ active: spellMode }">
  <span x-show="!spellMode">✏️ 拼写模式</span>
  <span x-show="spellMode">📖 认读模式</span>
</button>

<!-- 新代码 -->
<select class="quiz-mode-select" x-model="quizMode" @change="changeQuizMode()">
  <option value="reading">📖 认读模式</option>
  <option value="spelling">✏️ 拼写模式</option>
  <option value="listening">👂 听力模式</option>
</select>
```

#### 2. Alpine.js 状态管理（`public/app.js`）

**删除**：
- `spellMode: false`
- `loadSpellMode()`
- `toggleSpellMode()`

**新增**：
```javascript
// 状态
quizMode: 'reading',  // 'reading' | 'spelling' | 'listening'

// 方法
async loadQuizMode() {
  const res = await fetch('/api/settings/quizMode');
  if (res.ok) {
    const data = await res.json();
    this.quizMode = data.quizMode || 'reading';
  }
  this._quizModeLoaded = true;
}

async changeQuizMode() {
  this.hintRevealed = false;
  this.spellHint = '';
  await fetch('/api/settings/quizMode', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quizMode: this.quizMode }),
  });
}
```

**加载时机**：登录成功后调用 `loadQuizMode()`（替代 `loadSpellMode()`）。

#### 3. 模式相关的计算属性

```javascript
// 控制初始显示内容
get showEnglishPrompt() {
  return this.quizMode === 'reading' && !this.revealed;
}

get showChinesePrompt() {
  return this.quizMode === 'spelling' && !this.revealed;
}

get showAudioOnly() {
  return this.quizMode === 'listening' && !this.revealed;
}

// 控制显示答案后的内容
get showEnglishAnswer() {
  return this.revealed && (this.quizMode === 'spelling' || this.quizMode === 'listening');
}

get showChineseAnswer() {
  return this.revealed && this.quizMode === 'reading';
}

get showAnswerAudio() {
  return this.revealed && this.quizMode !== 'listening';
  // 听力模式答案区不需要发音按钮（初始已经听了）
}

// 提示功能
get showHintButton() {
  return !this.revealed && 
         (this.quizMode === 'spelling' || this.quizMode === 'listening');
}
```

#### 4. Quiz 记录调用变更

```javascript
// 旧代码（app.js:537-552）
async recordAnswer(correct) {
  await fetch('/api/quiz/record', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      word_id: this.currentWord.id,
      correct,
      spellMode: this.spellMode,  // 旧字段
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
      quizMode: this.quizMode,  // 新字段
    }),
  });
}
```

#### 5. HTML 模板变更（`public/index.html`）

**Quiz 卡片区域**（约 `index.html:113-175`）：

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

## 样式变更

**新增/修改 CSS**（`public/style.css`）：

```css
/* 模式下拉选择器 */
.quiz-mode-select {
  padding: 8px 16px;
  border: 2px solid var(--star-yellow);
  border-radius: 20px;
  background: white;
  font-size: 16px;
  cursor: pointer;
}

/* 听力模式大按钮 */
.btn-speak-large {
  font-size: 24px;
  padding: 20px 40px;
  border-radius: 50px;
  background: var(--star-yellow);
  border: none;
  cursor: pointer;
}

/* 答案区域样式 */
.answer-english {
  font-size: 32px;
  font-weight: bold;
  color: var(--star-blue);
}

.answer-chinese {
  font-size: 24px;
  color: var(--star-purple);
}
```

## 文件变更清单

**后端**：
- `src/api/settings.js` — 删除 spellMode 相关代码，新增 quizMode API
- `src/api/quiz.js` — 更新 record 接口接收 quizMode 参数

**前端**：
- `public/app.js` — 替换 spellMode 为 quizMode，新增计算属性，更新 recordAnswer
- `public/index.html` — 替换按钮为下拉菜单，更新 quiz 卡片模板
- `public/style.css` — 新增模式下拉框和听力模式样式

**测试**：
- `test/quiz.test.js` — 更新测试用例，测试三种模式
- `tests/quiz-sm2.test.js` — 如有涉及 spellMode 的测试，更新为 quizMode

## 测试要点

1. **模式切换**：
   - 切换模式后，偏好正确保存到后端
   - 刷新页面后，模式偏好恢复

2. **各模式显示**：
   - 认读模式：初始只显示英文，答案显示中文+发音
   - 拼写模式：初始只显示中文，答案显示英文+发音
   - 听力模式：初始只显示发音按钮，答案显示英文+中文

3. **提示功能**：
   - 拼写/听力模式显示"提示首字母"按钮
   - 认读模式不显示提示按钮

4. **答题记录**：
   - 三种模式下答题都能正确记录 quizMode
   - SM-2 算法正常工作

5. **Session 恢复**：
   - 刷新页面后，进度正确恢复
   - 模式切换不影响当前 session

## 未来扩展

1. **统计分析**：可以按模式统计正确率，帮助用户发现薄弱环节
2. **更多模式**：如"听写模式"（听发音写中文）等
3. **模式难度进阶**：根据用户水平自动推荐模式
