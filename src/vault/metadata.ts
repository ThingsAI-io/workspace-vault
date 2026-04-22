import Database from 'better-sqlite3';
import type { FileMetadata, KeyRecord } from '../types.js';

export interface KeyRecordFull extends KeyRecord {
  publicKey: string;
  wrappedMasterKey: Buffer;
  salt: string;
}

export class MetadataStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');

    this.db.exec(`
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

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS keys (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        public_key TEXT NOT NULL,
        wrapped_master_key BLOB NOT NULL,
        salt TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);
  }

  // ── File metadata CRUD ──────────────────────────────────────────────

  insertFile(meta: FileMetadata): void {
    this.db
      .prepare(
        `INSERT INTO files (id, vault_path, blob_id, size, created_at, modified_at, tags)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        meta.id,
        meta.vaultPath,
        meta.blobId,
        meta.size,
        meta.createdAt.toISOString(),
        meta.modifiedAt.toISOString(),
        JSON.stringify(meta.tags),
      );
  }

  getFile(vaultPath: string): FileMetadata | null {
    const row = this.db
      .prepare('SELECT * FROM files WHERE vault_path = ?')
      .get(vaultPath) as RawFileRow | undefined;
    return row ? toFileMetadata(row) : null;
  }

  getAllFiles(dirPath?: string): FileMetadata[] {
    if (dirPath) {
      const prefix = dirPath.endsWith('/') ? dirPath : dirPath + '/';
      const rows = this.db
        .prepare('SELECT * FROM files WHERE vault_path LIKE ? ORDER BY vault_path')
        .all(prefix + '%') as RawFileRow[];
      return rows.map(toFileMetadata);
    }
    const rows = this.db
      .prepare('SELECT * FROM files ORDER BY vault_path')
      .all() as RawFileRow[];
    return rows.map(toFileMetadata);
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
    this.db.prepare(`UPDATE files SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }

  deleteFile(vaultPath: string): void {
    this.db.prepare('DELETE FROM files WHERE vault_path = ?').run(vaultPath);
  }

  getFileCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS count FROM files').get() as {
      count: number;
    };
    return row.count;
  }

  // ── Key record CRUD ─────────────────────────────────────────────────

  insertKey(record: KeyRecordFull): void {
    this.db
      .prepare(
        `INSERT INTO keys (id, label, public_key, wrapped_master_key, salt, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.label,
        record.publicKey,
        record.wrappedMasterKey,
        record.salt,
        record.createdAt.toISOString(),
      );
  }

  getKey(id: string): KeyRecordFull | null {
    const row = this.db.prepare('SELECT * FROM keys WHERE id = ?').get(id) as
      | RawKeyRow
      | undefined;
    return row ? toKeyRecord(row) : null;
  }

  getAllKeys(): KeyRecordFull[] {
    const rows = this.db
      .prepare('SELECT * FROM keys ORDER BY created_at')
      .all() as RawKeyRow[];
    return rows.map(toKeyRecord);
  }

  deleteKey(id: string): void {
    this.db.prepare('DELETE FROM keys WHERE id = ?').run(id);
  }

  getKeyCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS count FROM keys').get() as {
      count: number;
    };
    return row.count;
  }

  // ── Search ──────────────────────────────────────────────────────────

  searchFiles(query: string): FileMetadata[] {
    const pattern = `%${query}%`;
    const rows = this.db
      .prepare(
        `SELECT * FROM files
         WHERE vault_path LIKE ? OR tags LIKE ?
         ORDER BY vault_path`,
      )
      .all(pattern, pattern) as RawFileRow[];
    return rows.map(toFileMetadata);
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
  wrapped_master_key: Buffer;
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
