# SM-2 Spaced Repetition Quiz Strategy Design

**Date**: 2026-05-10
**Status**: Approved

## Overview

Replace the current 15% random quiz algorithm with a strategy pattern, implementing SM-2 (SuperMemo-2) spaced repetition as the first strategy. Each user's review schedule is completely isolated.

## Database Design

### New Table: `sm2_reviews`

```sql
CREATE TABLE sm2_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  word_id INTEGER NOT NULL REFERENCES words(id),
  interval INTEGER NOT NULL DEFAULT 0,
  efactor REAL NOT NULL DEFAULT 2.5,
  repetitions INTEGER NOT NULL DEFAULT 0,
  next_review TEXT NOT NULL,
  last_review TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, word_id)
);

CREATE INDEX idx_sm2_reviews_next_review ON sm2_reviews(next_review);
```

| Column | Purpose |
|---|---|
| `interval` | Days until next review |
| `efactor` | Ease factor (default 2.5, min 1.3) |
| `repetitions` | Consecutive correct count |
| `next_review` | Next review date (YYYY-MM-DD) |
| `last_review` | Last review date |

Initial state for new words: interval=0, efactor=2.5, repetitions=0, next_review=today.

## SM-2 Algorithm

### Initial State (new word first appearance)
- interval = 0, efactor = 2.5, repetitions = 0, next_review = today

### On Correct Answer
```
if repetitions == 0: interval = 1
elif repetitions == 1: interval = 3
else: interval = interval * efactor

repetitions += 1
next_review = today + interval
```

### On Wrong Answer
```
repetitions = 0
interval = 0
next_review = today
efactor = max(1.3, efactor - 0.2)
```

### Word Selection Logic
1. Query `sm2_reviews` where `next_review <= today` for the user
2. Sort by priority: wrong answers first (last correct=0), then by next_review ascending
3. If due count exceeds daily limit, select up to limit words
4. New words (no sm2_reviews entry) are always included

### Daily Limit
- Default: 20% of total word count (user-configurable in the future)
- Excess due words are selected by priority (wrong > date ascending)

## API Design

### Strategy Interface

```javascript
// src/algorithms/quizStrategy.js
// getDueWords(userId, limit) => returns list of words to quiz
// recordResult(userId, wordId, correct) => updates SM-2 state
```

### Modified Routes

| Route | Old Logic | New Logic |
|---|---|---|
| `GET /api/quiz/today` | 15% random + all new | Call active strategy's `getDueWords` |
| `POST /api/quiz/record` | Insert quiz_records | Insert quiz_records + call `recordResult` |

### New Endpoints

| Route | Description |
|---|---|
| `GET /api/stats/sm2` | User SM-2 stats (total words, stage distribution, avg efactor) |
| `GET /api/stats/sm2/words` | Per-word SM-2 state (interval, efactor, next_review, repetitions) |

### Strategy Configuration
- Current: via constant or env variable `ACTIVE_STRATEGY=sm2`
- Future: stored in user preferences table

## File Structure

```
src/
  algorithms/
    quizStrategy.js        # Strategy interface
    sm2.js                 # SM-2 implementation
  api/
    quiz.js                # Modified: uses strategy pattern
    stats.js               # Modified: adds SM-2 stats endpoints
  db.js                    # Modified: creates sm2_reviews table
public/
  app.js                   # Modified: SM-2 stats panel
  index.html               # Modified: SM-2 stats tab
```

## Frontend Changes

- Quiz flow unchanged (same correct/wrong buttons)
- New "学习统计" tab → SM-2 panel showing per-word interval, efactor, next_review, repetitions
- Color coding by mastery level (high efactor = green, low = red)

## Error Handling & Edge Cases

| Scenario | Handling |
|---|---|
| No words for user | Return empty list |
| Due words exceed limit | Sort by wrong > date ascending, select up to limit |
| Wrong answer on new word | interval stays 0, next_review = today, appears again |
| Word deleted | Cascade delete sm2_reviews entry |
| Concurrent answers | SQLite WAL mode + transactions |
| Cross-day absence | All overdue words auto-include in next session |

## User Isolation

- Each user's SM-2 state is completely isolated via `user_id` in `sm2_reviews`
- Quiz records are also user-scoped
- Admin has no shared view (full isolation)
