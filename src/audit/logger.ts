import fs from 'node:fs';
import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js';
import { OperationType, type AuditEntry } from '../types.js';

export class AuditLogger {
  private db: SqlJsDatabase;
  private dbPath: string;

  private constructor(db: SqlJsDatabase, dbPath: string) {
    this.db = db;
    this.dbPath = dbPath;
  }

  static async create(dbPath: string): Promise<AuditLogger> {
    const SQL = await initSqlJs();
    const fileBuffer = fs.existsSync(dbPath) ? fs.readFileSync(dbPath) : undefined;
    const db = new SQL.Database(fileBuffer);

    db.run(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        operation TEXT NOT NULL,
        target_path TEXT,
        key_id TEXT,
        success INTEGER NOT NULL DEFAULT 1
      )
    `);

    const logger = new AuditLogger(db, dbPath);
    logger.persist();
    return logger;
  }

  private persist(): void {
    const data = this.db.export();
    fs.writeFileSync(this.dbPath, Buffer.from(data));
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
    this.db.run(
      'INSERT INTO audit_log (timestamp, operation, target_path, key_id, success) VALUES (?, ?, ?, ?, ?)',
      [timestamp, params.operation, params.targetPath ?? null, params.keyId ?? null, success],
    );
    this.persist();
  }

  /**
   * Query audit events with optional filtering.
   */
  getEvents(params?: { limit?: number; operation?: OperationType; since?: Date }): AuditEntry[] {
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

    const results: AuditEntry[] = [];
    const stmt = this.db.prepare(sql);
    stmt.bind(values as SqlJsBindParams);
    while (stmt.step()) {
      const row = stmt.getAsObject() as {
        id: number;
        timestamp: string;
        operation: string;
        target_path: string | null;
        key_id: string | null;
        success: number;
      };
      results.push({
        id: row.id,
        timestamp: new Date(row.timestamp),
        operation: row.operation as OperationType,
        targetPath: row.target_path ?? undefined,
        keyId: row.key_id ?? undefined,
        success: row.success === 1,
      });
    }
    stmt.free();
    return results;
  }

  /**
   * Get total count of audit events.
   */
  getEventCount(): number {
    const stmt = this.db.prepare('SELECT COUNT(*) AS count FROM audit_log');
    stmt.step();
    const row = stmt.getAsObject() as { count: number };
    stmt.free();
    return row.count;
  }

  /**
   * Close the database connection.
   */
  close(): void {
    this.db.close();
  }
}

type SqlJsBindParams = Parameters<SqlJsDatabase['run']>[1];
