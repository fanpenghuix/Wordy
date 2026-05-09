import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';

const testDbDir = path.join(process.cwd(), 'data-test');
process.env.DB_DIR = testDbDir;

// Import db module after setting env
const { default: db } = await import('../src/db.js');

describe('Database', () => {
  it('should have words table', () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    const tableNames = tables.map(t => t.name);
    expect(tableNames).toContain('words');
    expect(tableNames).toContain('quiz_records');
  });

  it('should insert and query a word', () => {
    const result = db.prepare("INSERT INTO words (english, chinese, created_at) VALUES (?, ?, ?)")
      .run('test', '测试', '2026-05-09');
    expect(result.changes).toBe(1);

    const row = db.prepare('SELECT * FROM words WHERE english = ?').get('test');
    expect(row.english).toBe('test');
    expect(row.chinese).toBe('测试');
  });
});

afterAll(() => {
  db.close();
  fs.rmSync(testDbDir, { recursive: true, force: true });
});
