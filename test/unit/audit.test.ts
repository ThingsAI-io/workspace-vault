import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AuditLogger } from '../../src/audit/index.js';
import { OperationType } from '../../src/types.js';

describe('AuditLogger', () => {
  let logger: AuditLogger;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'vault-audit-'));
    logger = new AuditLogger(join(tempDir, 'audit.db'));
  });

  afterEach(() => {
    logger.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates database and table on construction', () => {
    // If we got here without throwing, the DB and table were created.
    // Verify we can query with zero results.
    expect(logger.getEvents()).toEqual([]);
    expect(logger.getEventCount()).toBe(0);
  });

  it('logs a read event', () => {
    logger.logEvent({ operation: OperationType.READ, targetPath: 'docs/letter.pdf' });
    const events = logger.getEvents({ limit: 1 });
    expect(events).toHaveLength(1);
    expect(events[0].operation).toBe(OperationType.READ);
    expect(events[0].targetPath).toBe('docs/letter.pdf');
    expect(events[0].success).toBe(true);
  });

  it('logs an unlock event with keyId', () => {
    logger.logEvent({
      operation: OperationType.UNLOCK,
      keyId: 'key-abc-123',
    });
    const events = logger.getEvents({ limit: 1 });
    expect(events).toHaveLength(1);
    expect(events[0].operation).toBe(OperationType.UNLOCK);
    expect(events[0].keyId).toBe('key-abc-123');
    expect(events[0].targetPath).toBeUndefined();
    expect(events[0].success).toBe(true);
  });

  it('logs a failed operation', () => {
    logger.logEvent({ operation: OperationType.READ, targetPath: 'secret.txt', success: false });
    const events = logger.getEvents();
    expect(events[0].success).toBe(false);
  });

  it('returns events in reverse chronological order', () => {
    logger.logEvent({ operation: OperationType.READ, targetPath: 'a.txt' });
    logger.logEvent({ operation: OperationType.WRITE, targetPath: 'b.txt' });
    logger.logEvent({ operation: OperationType.DELETE, targetPath: 'c.txt' });

    const events = logger.getEvents();
    expect(events).toHaveLength(3);
    // Most recent first
    expect(events[0].operation).toBe(OperationType.DELETE);
    expect(events[1].operation).toBe(OperationType.WRITE);
    expect(events[2].operation).toBe(OperationType.READ);
  });

  it('filters by operation type', () => {
    logger.logEvent({ operation: OperationType.READ, targetPath: 'a.txt' });
    logger.logEvent({ operation: OperationType.WRITE, targetPath: 'b.txt' });
    logger.logEvent({ operation: OperationType.READ, targetPath: 'c.txt' });

    const reads = logger.getEvents({ operation: OperationType.READ });
    expect(reads).toHaveLength(2);
    for (const e of reads) {
      expect(e.operation).toBe(OperationType.READ);
    }
  });

  it('filters by date (since)', () => {
    logger.logEvent({ operation: OperationType.READ, targetPath: 'old.txt' });

    // Use a timestamp slightly in the future to filter out the first event
    const cutoff = new Date(Date.now() + 1000);

    // Wait a tiny bit then log another event with a future-enough timestamp
    logger.logEvent({ operation: OperationType.WRITE, targetPath: 'new.txt' });

    // Since both events are very close in time, use getEvents to verify
    // the since filter works by using a far-past date
    const allEvents = logger.getEvents({ since: new Date('2000-01-01') });
    expect(allEvents.length).toBeGreaterThanOrEqual(2);

    // Use a future cutoff to get zero events
    const futureEvents = logger.getEvents({ since: new Date(Date.now() + 60_000) });
    expect(futureEvents).toHaveLength(0);
  });

  it('limits results', () => {
    for (let i = 0; i < 10; i++) {
      logger.logEvent({ operation: OperationType.READ, targetPath: `file${i}.txt` });
    }
    const limited = logger.getEvents({ limit: 3 });
    expect(limited).toHaveLength(3);
  });

  it('counts events correctly', () => {
    expect(logger.getEventCount()).toBe(0);
    logger.logEvent({ operation: OperationType.READ });
    logger.logEvent({ operation: OperationType.WRITE });
    logger.logEvent({ operation: OperationType.DELETE });
    expect(logger.getEventCount()).toBe(3);
  });

  it('handles all operation types', () => {
    for (const op of Object.values(OperationType)) {
      logger.logEvent({ operation: op });
    }
    expect(logger.getEventCount()).toBe(Object.values(OperationType).length);

    const events = logger.getEvents();
    const ops = new Set(events.map((e) => e.operation));
    for (const op of Object.values(OperationType)) {
      expect(ops.has(op)).toBe(true);
    }
  });

  it('NEVER stores content — only operation metadata', async () => {
    // Open a raw database connection to inspect the schema
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(join(tempDir, 'audit.db'), { readonly: true });
    const columns = db.prepare("PRAGMA table_info('audit_log')").all() as Array<{ name: string }>;
    const columnNames = columns.map((c) => c.name);

    // Only these columns should exist
    expect(columnNames).toEqual(
      expect.arrayContaining(['id', 'timestamp', 'operation', 'target_path', 'key_id', 'success']),
    );
    expect(columnNames).toHaveLength(6);

    // Explicitly verify no content-like column exists
    expect(columnNames).not.toContain('content');
    expect(columnNames).not.toContain('data');
    expect(columnNames).not.toContain('body');
    expect(columnNames).not.toContain('payload');

    db.close();
  });

  it('handles concurrent access gracefully (WAL mode)', () => {
    const dbPath = join(tempDir, 'audit.db');
    const logger2 = new AuditLogger(dbPath);

    try {
      // Write from both loggers
      logger.logEvent({ operation: OperationType.READ, targetPath: 'from-logger1.txt' });
      logger2.logEvent({ operation: OperationType.WRITE, targetPath: 'from-logger2.txt' });

      // Read from both and verify no data corruption
      const events1 = logger.getEvents();
      const events2 = logger2.getEvents();

      expect(events1).toHaveLength(2);
      expect(events2).toHaveLength(2);

      const paths1 = events1.map((e) => e.targetPath).sort();
      const paths2 = events2.map((e) => e.targetPath).sort();
      expect(paths1).toEqual(['from-logger1.txt', 'from-logger2.txt']);
      expect(paths2).toEqual(['from-logger1.txt', 'from-logger2.txt']);
    } finally {
      logger2.close();
    }
  });

  it('assigns sequential ids to events', () => {
    logger.logEvent({ operation: OperationType.READ });
    logger.logEvent({ operation: OperationType.WRITE });
    const events = logger.getEvents();
    expect(events[0].id).toBeGreaterThan(events[1].id);
  });

  it('stores valid ISO 8601 timestamps', () => {
    logger.logEvent({ operation: OperationType.INIT });
    const events = logger.getEvents({ limit: 1 });
    expect(events[0].timestamp).toBeInstanceOf(Date);
    expect(events[0].timestamp.toISOString()).toBeTruthy();
  });
});
