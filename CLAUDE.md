# Word Quiz

单词抽查 Web 应用，支持答题、词库管理和 Google TTS 发音。

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
  api/
    words.js         # 单词 CRUD
    quiz.js          # 抽题组卷、答案记录
    stats.js         # 统计（每日、趋势、错词排行）
    speak.js         # Google TTS：GET /voices, POST /speak
public/
  index.html         # SPA 模板（Alpine.js + x-show）
  app.js             # 前端逻辑（quizApp）
  style.css          # 星星主题样式
```

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
