# Word Quiz System — Design Specification

> Children's word spelling quiz app, deployed in Docker, with a starry-sky themed UI.

## 1. Overview

A web-based quiz system for testing children's English word spelling. Words are displayed in Chinese, the child spells them verbally and writes them on paper, then the parent marks correct/incorrect. Words are stored in SQLite, managed via a hidden admin panel, and deployed as a single Docker container.

## 2. Requirements

### Functional
- **Quiz**: Display Chinese meaning → reveal English word → mark correct/incorrect
- **Daily selection**: 15% of word bank, new words (added today) must always be included
- **Word management**: Add/edit/delete words (English + Chinese) via admin panel
- **Statistics**: Per-word accuracy, daily reports, trend charts, wrong-word ranking
- **UI**: Starry-sky theme, cartoon style, celebratory animation on correct answer (stars + thumbs-up)

### Non-functional
- Mobile landscape mode (AirPlay to TV)
- Docker deployment with volume persistence
- No build tools — Alpine.js frontend, Express.js backend, all served from one container

## 3. Architecture

```
┌─────────────────────────────────────────┐
│           Docker Container              │
│                                         │
│  ┌──────────────┐    ┌───────────────┐  │
│  │   Frontend   │    │    Backend    │  │
│  │  Alpine.js   │◄──►│   Express.js  │  │
│  │  HTML/CSS    │    │   REST API    │  │
│  │  Starry theme│    │   SQLite      │  │
│  └──────────────┘    └───────┬───────┘  │
│                              │          │
│                    ┌─────────▼───────┐  │
│                    │  words.db       │  │
│                    │  (SQLite)       │  │
│                    └─────────────────┘  │
└─────────────────────────────────────────┘
         ▲
    Phone landscape
    AirPlay to TV
```

## 4. Data Model

### words table
| Column     | Type     | Constraints        | Description     |
|------------|----------|--------------------|-----------------|
| id         | INTEGER  | PRIMARY KEY        | Auto-increment  |
| english    | TEXT     | NOT NULL, UNIQUE   | English word    |
| chinese    | TEXT     | NOT NULL           | Chinese meaning |
| created_at | TEXT     | NOT NULL           | Date added (YYYY-MM-DD) |

### quiz_records table
| Column    | Type     | Constraints                    | Description              |
|-----------|----------|--------------------------------|--------------------------|
| id        | INTEGER  | PRIMARY KEY                    | Auto-increment           |
| word_id   | INTEGER  | NOT NULL, REFERENCES words(id) | Word being tested        |
| correct   | INTEGER  | NOT NULL (0 or 1)              | 1=correct, 0=incorrect   |
| quiz_date | TEXT     | NOT NULL                       | Quiz date (YYYY-MM-DD)   |

## 5. API Design

| Method   | Path                  | Request Body                  | Description                    |
|----------|-----------------------|-------------------------------|--------------------------------|
| GET      | `/api/words`          | —                             | List all words                 |
| POST     | `/api/words`          | `{english, chinese}`          | Add a word                     |
| PUT      | `/api/words/:id`      | `{english, chinese}`          | Edit a word                    |
| DELETE   | `/api/words/:id`      | —                             | Delete a word                  |
| GET      | `/api/quiz/today`     | —                             | Generate today's quiz list     |
| POST     | `/api/quiz/record`    | `{word_id, correct}`          | Record a quiz answer           |
| GET      | `/api/stats/word/:id` | —                             | Per-word accuracy stats        |
| GET      | `/api/stats/daily`    | —                             | Daily report                   |
| GET      | `/api/stats/trend`    | `?period=week` (default: `week`)  | Trend data                     |
| GET      | `/api/stats/worst`    | `?limit=10`                   | Wrong-word ranking (top N)     |

### Quiz Selection Algorithm (`GET /api/quiz/today`)
1. Select all words where `created_at == today` (new words) — always included
2. From remaining words, randomly select `ceil(total_words * 0.15)` words
3. Return combined list shuffled

## 6. Frontend Design

### 6.1 Quiz Page (Main)
- **Header**: "⭐ 单词抽查", progress indicator "X/Y", hidden admin button (gear icon)
- **Center**: Large Chinese meaning displayed. Below: "点击显示答案" button.
- **After reveal**: English word shown with golden glow effect. Two buttons: "👍 答对了 +1" (green) and "💪 再想想" (blue).
- **On correct**: Stars fall from top + large 👍 icon appears + "Great!" text.
- **On incorrect**: Word turns red + "加油！再记一遍" encouragement.
- **Navigation**: After marking correct/incorrect, a "下一个 →" button appears for manual advancement. Parent controls the pace.

### 6.2 Admin Panel (Slide-out Drawer)
Triggered by gear icon in header corner. Slides in from right side.

**Tabs:**
- **添加单词**: Two input fields (English, Chinese), save button. Quick-add mode for batch entry.
- **词库管理**: Table of all words with edit/delete actions. Search and sort.
- **统计数据**:
  - Tab 1: 单词详情 — per-word accuracy
  - Tab 2: 每日报告 — daily quiz count and accuracy
  - Tab 3: 趋势图 — line chart of accuracy over time (weekly/monthly)
  - Tab 4: 错词排行 — lowest accuracy words

### 6.3 Styling
- **Theme**: Dark blue background (#0a0a2e gradient), star particle effects
- **Typography**: Large, readable fonts (28px+ for quiz word, 20px+ for Chinese)
- **Colors**: Purple/violet accents (#7c3aed), white text, gold for correct words
- **Buttons**: Large, rounded, shadow effects for cartoon feel
- **Animations**: CSS keyframes for falling stars, scale-in for thumbs-up, pulse for correct answer

## 7. Error Handling
- Empty word bank: Show friendly message "还没有单词哦，快去添加吧！" with arrow to admin
- No words for today quiz: Same as above
- Duplicate word on add: Return 409 with message "该单词已存在"
- Invalid API input: Return 400 with field-level errors
- Database errors: Return 500, log to stderr, show generic error UI

## 8. Testing
- **Backend**: Unit tests for quiz selection algorithm (verifies new words always included, 15% ratio), CRUD operations, stats aggregation queries
- **Frontend**: Manual testing of quiz flow, admin panel, responsive layout on mobile landscape

## 9. File Structure

```
word-tester/
├── docker-compose.yml
├── Dockerfile
├── package.json
├── src/
│   ├── server.js           # Express app + routes
│   ├── db.js               # SQLite setup + schema migration
│   └── api/
│       ├── words.js        # Word CRUD endpoints
│       ├── quiz.js         # Quiz generation + recording
│       └── stats.js        # Statistics endpoints
├── public/
│   ├── index.html          # Main SPA
│   ├── app.js              # Alpine.js application logic
│   └── style.css           # Starry theme styles
└── data/                   # SQLite DB directory (mounted as volume)
```

## 10. Docker Configuration
- Base image: `node:20-alpine`
- Port: 3000
- Volume: `word-data:/app/data`
- Health check: `curl -f http://localhost:3000/api/words || exit 1`
- Non-root user for security
