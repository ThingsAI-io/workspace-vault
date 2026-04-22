import Database from 'better-sqlite3';
import { OperationType, type AuditEntry } from '../types.js';

export class AuditLogger {
  private db: Database.Database;
  private insertStmt: Database.Statement;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);

    this.db.pragma('journal_mode = WAL');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        operation TEXT NOT NULL,
        target_path TEXT,
        key_id TEXT,
        success INTEGER NOT NULL DEFAULT 1
      )
    `);

    this.insertStmt = this.db.prepare(
      'INSERT INTO audit_log (timestamp, operation, target_path, key_id, success) VALUES (?, ?, ?, ?, ?)',
    );
  }

  /**
   * Log an audit event. NEVER include file content in any field.
   */
  logEvent(params: {
    operation: OperationType;
    targetPath?: string;
    keyId?: string;
    success?: boolean;
  }): void {
    const timestamp = new Date().toISOString();
    const success = params.success === undefined ? 1 : params.success ? 1 : 0;
    this.insertStmt.run(
      timestamp,
      params.operation,
      params.targetPath ?? null,
      params.keyId ?? null,
      success,
    );
  }

  /**
   * Query audit events with optional filtering.
   */
  getEvents(params?: {
    limit?: number;
    operation?: OperationType;
    since?: Date;
  }): AuditEntry[] {
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (params?.operation) {
      conditions.push('operation = ?');
      values.push(params.operation);
    }

    if (params?.since) {
      conditions.push('timestamp >= ?');
      values.push(params.since.toISOString());
    }

    let sql = 'SELECT * FROM audit_log';
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY id DESC';

    if (params?.limit) {
      sql += ' LIMIT ?';
      values.push(params.limit);
    }

    const rows = this.db.prepare(sql).all(...values) as Array<{
      id: number;
      timestamp: string;
      operation: string;
      target_path: string | null;
      key_id: string | null;
      success: number;
    }>;

    return rows.map((row) => ({
      id: row.id,
      timestamp: new Date(row.timestamp),
      operation: row.operation as OperationType,
      targetPath: row.target_path ?? undefined,
      keyId: row.key_id ?? undefined,
      success: row.success === 1,
    }));
  }

  /**
   * Get total count of audit events.
   */
  getEventCount(): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS count FROM audit_log')
      .get() as { count: number };
    return row.count;
  }

  /**
   * Close the database connection.
   */
  close(): void {
    this.db.close();
  }
}
