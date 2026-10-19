# Wordy

Wordy — 单词抽查 Web 应用，支持答题、词库管理和 Google TTS 发音。

## Tech Stack

- **Backend**: Express 5 + better-sqlite3 (ESM, `type: "module"`)
- **Frontend**: Alpine.js SPA + 星星主题 CSS
- **TTS**: `@google-cloud/text-to-speech` (en-GB 英式发音)
- **Test**: vitest + supertest

## Project Structure

```
src/
  server.js          # 入口，注册路由 /api/*
  db.js              # SQLite 数据库初始化
  middleware/
    auth.js          # 认证中间件（requireAuth, requireAdmin）
  algorithms/
    quizStrategy.js  # SM-2 抽题算法
    sm2.js           # SM-2 间隔重复算法
  api/
    auth.js          # 登录/注册
    words.js         # 单词 CRUD
    quiz.js          # 抽题组卷、答案记录、Session 恢复
    stats.js         # 统计（每日、趋势、错词排行）
    settings.js      # 用户偏好设置（语音、模式等）
    speak.js         # Google TTS：GET /voices, POST /speak
public/
  index.html         # SPA 模板（Alpine.js + x-show）
  app.js             # 前端逻辑（quizApp）
  style.css          # 星星主题样式
test/                # API 集成测试
tests/               # 算法单元测试
```

## Quiz Modes

支持三种答题模式，通过 `quizMode` 设置（存储在 `user_preferences` 表）：

| 模式 | 值 | 题目显示 | 答案显示 | 提示功能 |
|------|-----|---------|---------|---------|
| 认读模式 | `reading` | 英文 | 中文 + 发音 | 无 |
| 拼写模式 | `spelling` | 中文 | 英文 + 发音 | 提示首字母 |
| 听力模式 | `listening` | 发音按钮 | 英文 + 中文 | 提示首字母 |

- 默认模式：`reading`
- API: `GET/PUT /api/settings/quizMode`
- 前端：下拉菜单切换，偏好保存到数据库

## Dev

```bash
# 生产
docker compose up -d --build

# 本地调试（含 override，代码热重载）
docker compose up -d

# 直接运行
npm run dev
```

> `docker-compose.override.yml` 仅在本地存在，自动合并 volumes 和 `--watch`，不提交到仓库。

## Google TTS

需要 `google-credentials.json`（Service Account 密钥）放在项目根目录，已被 `.gitignore` 排除。
