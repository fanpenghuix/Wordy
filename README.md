# Wordy

一个支持 **SM-2 间隔重复算法** 的单词抽查 Web 应用，带有 Google TTS 发音功能。

## 功能特性

- **SM-2 间隔重复** — 基于 SuperMemo-2 算法智能安排复习计划，自动调整单词间隔、难度系数和掌握程度
- **双模式抽查** — 认读模式（看中文想英文）和拼写模式（听发音拼单词）
- **Google TTS 发音** — 支持英式发音，可调节性别、发音人和语速
- **多用户支持** — 用户注册登录，独立词库和复习进度
- **每日限额** — 支持按比例或固定词数设置每日抽查量
- **数据统计** — 每日报告、正确率趋势、错词排行、SM-2 状态总览
- **单词管理** — 增删改查、搜索、分页

## 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | Express 5 + better-sqlite3 (ESM) |
| 前端 | Alpine.js SPA |
| TTS | @google-cloud/text-to-speech (en-GB) |
| 测试 | vitest + supertest |
| 认证 | bcrypt + express-session |

## 快速开始

### Docker 部署（推荐）

```bash
docker compose up -d --build
```

服务默认运行在 `http://localhost:8900`。

### 本地开发

```bash
npm install
npm run dev          # 代码热重载
```

### 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | 服务端口 | `3000` |
| `SESSION_SECRET` | Session 密钥 | 随机生成 |
| `ACTIVE_STRATEGY` | 抽查策略 | `sm2` |

### Google TTS 配置

如需使用 TTS 发音功能，需要在项目根目录放置 `google-credentials.json`（Service Account 密钥文件）。Docker 部署时通过 volume 挂载。

## 项目结构

```
src/
  server.js              # 入口，Session 配置，路由注册
  db.js                  # SQLite 初始化，建表
  api/
    auth.js              # 用户认证（登录/登出）
    users.js             # 用户 CRUD（管理员功能）
    words.js             # 单词增删改查
    quiz.js              # 抽题组卷、答案记录
    stats.js             # 统计（每日/趋势/错词排行）
    speak.js             # Google TTS 接口
    settings.js          # 用户偏好设置（语音/限额）
  algorithms/
    sm2.js               # SM-2 间隔重复算法
    quizStrategy.js      # 抽题策略接口
public/
  index.html             # SPA 模板（Alpine.js）
  app.js                 # 前端逻辑
  style.css              # 星星主题样式
```

## API 路由

| 路由 | 说明 |
|------|------|
| `POST /api/auth/login` | 登录 |
| `POST /api/auth/logout` | 登出 |
| `GET /api/auth/me` | 获取当前用户 |
| `GET/POST/PUT/DELETE /api/words` | 单词 CRUD |
| `POST /api/quiz/start` | 开始抽查 |
| `POST /api/quiz/answer` | 提交答案 |
| `GET /api/stats/daily` | 每日统计 |
| `GET /api/stats/trend` | 正确率趋势 |
| `GET /api/stats/worst` | 错词排行 |
| `GET /api/stats/sm2` | SM-2 状态总览 |
| `GET /api/speak` | 获取可用语音 |
| `POST /api/speak` | 生成语音音频 |
| `GET/PUT /api/settings` | 用户偏好设置 |
| `GET/POST/PUT/DELETE /api/users` | 用户管理（管理员） |

## 运行测试

```bash
npm test
```
