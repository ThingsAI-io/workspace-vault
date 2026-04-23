import fs from 'node:fs';
import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js';
import type { FileMetadata, KeyRecord } from '../types.js';

type SqlJsBindParams = Parameters<SqlJsDatabase['run']>[1];

export interface KeyRecordFull extends KeyRecord {
  publicKey: string;
  wrappedMasterKey: Buffer;
  salt: string;
}

export class MetadataStore {
  private db: SqlJsDatabase;
  private dbPath: string;

  private constructor(db: SqlJsDatabase, dbPath: string) {
    this.db = db;
    this.dbPath = dbPath;
  }

  static async create(dbPath: string): Promise<MetadataStore> {
    const SQL = await initSqlJs();
    const fileBuffer = fs.existsSync(dbPath) ? fs.readFileSync(dbPath) : undefined;
    const db = new SQL.Database(fileBuffer);

    db.run(`
      CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY,
        vault_path TEXT UNIQUE NOT NULL,
        blob_id TEXT NOT NULL,
        size INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        modified_at TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]'
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS keys (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        public_key TEXT NOT NULL,
        wrapped_master_key BLOB NOT NULL,
        salt TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);

    const store = new MetadataStore(db, dbPath);
    store.persist();
    return store;
  }

  private persist(): void {
    const data = this.db.export();
    fs.writeFileSync(this.dbPath, Buffer.from(data));
  }

  // ── File metadata CRUD ──────────────────────────────────────────────

  insertFile(meta: FileMetadata): void {
    this.db.run(
      `INSERT INTO files (id, vault_path, blob_id, size, created_at, modified_at, tags)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        meta.id,
        meta.vaultPath,
        meta.blobId,
        meta.size,
        meta.createdAt.toISOString(),
        meta.modifiedAt.toISOString(),
        JSON.stringify(meta.tags),
      ],
    );
    this.persist();
  }

  getFile(vaultPath: string): FileMetadata | null {
    const stmt = this.db.prepare('SELECT * FROM files WHERE vault_path = ?');
    stmt.bind([vaultPath]);
    let result: FileMetadata | null = null;
    if (stmt.step()) {
      result = toFileMetadata(stmt.getAsObject() as unknown as RawFileRow);
    }
    stmt.free();
    return result;
  }

  getAllFiles(dirPath?: string): FileMetadata[] {
    const results: FileMetadata[] = [];
    if (dirPath) {
      const prefix = dirPath.endsWith('/') ? dirPath : dirPath + '/';
      const stmt = this.db.prepare(
        'SELECT * FROM files WHERE vault_path LIKE ? ORDER BY vault_path',
      );
      stmt.bind([prefix + '%']);
      while (stmt.step()) {
        results.push(toFileMetadata(stmt.getAsObject() as unknown as RawFileRow));
      }
      stmt.free();
      return results;
    }
    const stmt = this.db.prepare('SELECT * FROM files ORDER BY vault_path');
    while (stmt.step()) {
      results.push(toFileMetadata(stmt.getAsObject() as unknown as RawFileRow));
    }
    stmt.free();
    return results;
  }

  updateFile(
    id: string,
    updates: Partial<Pick<FileMetadata, 'size' | 'modifiedAt' | 'tags'>>,
  ): void {
    const sets: string[] = [];
    const values: unknown[] = [];

    if (updates.size !== undefined) {
      sets.push('size = ?');
      values.push(updates.size);
    }
    if (updates.modifiedAt !== undefined) {
      sets.push('modified_at = ?');
      values.push(updates.modifiedAt.toISOString());
    }
    if (updates.tags !== undefined) {
      sets.push('tags = ?');
      values.push(JSON.stringify(updates.tags));
    }

    if (sets.length === 0) return;
    values.push(id);
    this.db.run(`UPDATE files SET ${sets.join(', ')} WHERE id = ?`, values as SqlJsBindParams);
    this.persist();
  }

  deleteFile(vaultPath: string): void {
    this.db.run('DELETE FROM files WHERE vault_path = ?', [vaultPath]);
    this.persist();
  }

  getFileCount(): number {
    const stmt = this.db.prepare('SELECT COUNT(*) AS count FROM files');
    stmt.step();
    const row = stmt.getAsObject() as { count: number };
    stmt.free();
    return row.count;
  }

  // ── Key record CRUD ─────────────────────────────────────────────────

  insertKey(record: KeyRecordFull): void {
    this.db.run(
      `INSERT INTO keys (id, label, public_key, wrapped_master_key, salt, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        record.id,
        record.label,
        record.publicKey,
        record.wrappedMasterKey,
        record.salt,
        record.createdAt.toISOString(),
      ],
    );
    this.persist();
  }

  getKey(id: string): KeyRecordFull | null {
    const stmt = this.db.prepare('SELECT * FROM keys WHERE id = ?');
    stmt.bind([id]);
    let result: KeyRecordFull | null = null;
    if (stmt.step()) {
      result = toKeyRecord(stmt.getAsObject() as unknown as RawKeyRow);
    }
    stmt.free();
    return result;
  }

  getAllKeys(): KeyRecordFull[] {
    const results: KeyRecordFull[] = [];
    const stmt = this.db.prepare('SELECT * FROM keys ORDER BY created_at');
    while (stmt.step()) {
      results.push(toKeyRecord(stmt.getAsObject() as unknown as RawKeyRow));
    }
    stmt.free();
    return results;
  }

  deleteKey(id: string): void {
    this.db.run('DELETE FROM keys WHERE id = ?', [id]);
    this.persist();
  }

  getKeyCount(): number {
    const stmt = this.db.prepare('SELECT COUNT(*) AS count FROM keys');
    stmt.step();
    const row = stmt.getAsObject() as { count: number };
    stmt.free();
    return row.count;
  }

  // ── Search ──────────────────────────────────────────────────────────

  searchFiles(query: string): FileMetadata[] {
    const pattern = `%${query}%`;
    const results: FileMetadata[] = [];
    const stmt = this.db.prepare(
      `SELECT * FROM files
       WHERE vault_path LIKE ? OR tags LIKE ?
       ORDER BY vault_path`,
    );
    stmt.bind([pattern, pattern]);
    while (stmt.step()) {
      results.push(toFileMetadata(stmt.getAsObject() as unknown as RawFileRow));
    }
    stmt.free();
    return results;
  }

  close(): void {
    this.db.close();
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────

interface RawFileRow {
  id: string;
  vault_path: string;
  blob_id: string;
  size: number;
  created_at: string;
  modified_at: string;
  tags: string;
}

interface RawKeyRow {
  id: string;
  label: string;
  public_key: string;
  wrapped_master_key: Uint8Array;
  salt: string;
  created_at: string;
}

function toFileMetadata(row: RawFileRow): FileMetadata {
  return {
    id: row.id,
    vaultPath: row.vault_path,
    blobId: row.blob_id,
    size: row.size,
    createdAt: new Date(row.created_at),
    modifiedAt: new Date(row.modified_at),
    tags: JSON.parse(row.tags) as string[],
  };
}

function toKeyRecord(row: RawKeyRow): KeyRecordFull {
  return {
    id: row.id,
    label: row.label,
    publicKey: row.public_key,
    wrappedMasterKey: Buffer.from(row.wrapped_master_key),
    salt: row.salt,
    createdAt: new Date(row.created_at),
  };
}
