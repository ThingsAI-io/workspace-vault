import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { VaultEngine } from '../../src/vault/engine.js';
import { MetadataStore } from '../../src/vault/metadata.js';
import {
  FileNotFoundError,
  FileAlreadyExistsError,
  KeyNotFoundError,
  InvalidKeyError,
  LastKeyError,
} from '../../src/types.js';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vault-test-'));
}

function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ── MetadataStore ─────────────────────────────────────────────────────────

describe('MetadataStore', () => {
  let tmpDir: string;
  let store: MetadataStore;

  beforeEach(() => {
    tmpDir = makeTempDir();
    store = new MetadataStore(path.join(tmpDir, 'vault.db'));
  });

  afterEach(() => {
    store.close();
    cleanup(tmpDir);
  });

  it('inserts and retrieves file metadata', () => {
    const meta = {
      id: 'f1',
      vaultPath: 'docs/readme.md',
      blobId: 'blob-1',
      size: 42,
      createdAt: new Date('2024-01-01'),
      modifiedAt: new Date('2024-01-02'),
      tags: ['doc', 'readme'],
    };
    store.insertFile(meta);
    const result = store.getFile('docs/readme.md');
    expect(result).not.toBeNull();
    expect(result!.id).toBe('f1');
    expect(result!.vaultPath).toBe('docs/readme.md');
    expect(result!.tags).toEqual(['doc', 'readme']);
    expect(result!.size).toBe(42);
  });

  it('returns null for non-existent file', () => {
    expect(store.getFile('nonexistent')).toBeNull();
  });

  it('getAllFiles returns all files', () => {
    store.insertFile({
      id: 'f1',
      vaultPath: 'a.txt',
      blobId: 'b1',
      size: 1,
      createdAt: new Date(),
      modifiedAt: new Date(),
      tags: [],
    });
    store.insertFile({
      id: 'f2',
      vaultPath: 'b.txt',
      blobId: 'b2',
      size: 2,
      createdAt: new Date(),
      modifiedAt: new Date(),
      tags: [],
    });
    expect(store.getAllFiles()).toHaveLength(2);
  });

  it('getAllFiles with dirPath filters by prefix', () => {
    store.insertFile({
      id: 'f1',
      vaultPath: 'docs/a.txt',
      blobId: 'b1',
      size: 1,
      createdAt: new Date(),
      modifiedAt: new Date(),
      tags: [],
    });
    store.insertFile({
      id: 'f2',
      vaultPath: 'other/b.txt',
      blobId: 'b2',
      size: 2,
      createdAt: new Date(),
      modifiedAt: new Date(),
      tags: [],
    });
    const results = store.getAllFiles('docs');
    expect(results).toHaveLength(1);
    expect(results[0].vaultPath).toBe('docs/a.txt');
  });

  it('updateFile updates fields', () => {
    store.insertFile({
      id: 'f1',
      vaultPath: 'test.txt',
      blobId: 'b1',
      size: 10,
      createdAt: new Date(),
      modifiedAt: new Date('2024-01-01'),
      tags: [],
    });
    store.updateFile('f1', {
      size: 99,
      tags: ['updated'],
      modifiedAt: new Date('2024-06-01'),
    });
    const result = store.getFile('test.txt')!;
    expect(result.size).toBe(99);
    expect(result.tags).toEqual(['updated']);
  });

  it('deleteFile removes file', () => {
    store.insertFile({
      id: 'f1',
      vaultPath: 'test.txt',
      blobId: 'b1',
      size: 1,
      createdAt: new Date(),
      modifiedAt: new Date(),
      tags: [],
    });
    store.deleteFile('test.txt');
    expect(store.getFile('test.txt')).toBeNull();
    expect(store.getFileCount()).toBe(0);
  });

  it('searchFiles matches vault_path', () => {
    store.insertFile({
      id: 'f1',
      vaultPath: 'contracts/lease.pdf',
      blobId: 'b1',
      size: 1,
      createdAt: new Date(),
      modifiedAt: new Date(),
      tags: [],
    });
    const results = store.searchFiles('lease');
    expect(results).toHaveLength(1);
    expect(results[0].vaultPath).toBe('contracts/lease.pdf');
  });

  it('searchFiles matches tags', () => {
    store.insertFile({
      id: 'f1',
      vaultPath: 'file.txt',
      blobId: 'b1',
      size: 1,
      createdAt: new Date(),
      modifiedAt: new Date(),
      tags: ['important', 'legal'],
    });
    const results = store.searchFiles('legal');
    expect(results).toHaveLength(1);
  });

  it('key CRUD operations work', () => {
    store.insertKey({
      id: 'k1',
      label: 'test key',
      publicKey: 'pub-1',
      wrappedMasterKey: Buffer.from('wrapped'),
      salt: 'salt-1',
      createdAt: new Date(),
    });

    expect(store.getKeyCount()).toBe(1);
    const key = store.getKey('k1');
    expect(key).not.toBeNull();
    expect(key!.label).toBe('test key');
    expect(key!.publicKey).toBe('pub-1');

    const allKeys = store.getAllKeys();
    expect(allKeys).toHaveLength(1);

    store.deleteKey('k1');
    expect(store.getKeyCount()).toBe(0);
    expect(store.getKey('k1')).toBeNull();
  });
});

// ── VaultEngine ───────────────────────────────────────────────────────────

describe('VaultEngine', () => {
  let tmpDir: string;
  let vaultDir: string;
  let engine: VaultEngine;
  let masterKey: string;
  const TEST_PASSPHRASE = 'test-vault-passphrase-123';

  beforeEach(async () => {
    tmpDir = makeTempDir();
    vaultDir = path.join(tmpDir, 'vault');
    engine = await VaultEngine.init(vaultDir, TEST_PASSPHRASE);
    masterKey = await engine.unlock(TEST_PASSPHRASE);
  });

  afterEach(() => {
    engine.close();
    cleanup(tmpDir);
  });

  // ── Init ──────────────────────────────────────────────────────────

  describe('init', () => {
    it('creates vault directory structure', () => {
      expect(fs.existsSync(vaultDir)).toBe(true);
      expect(fs.existsSync(path.join(vaultDir, 'files'))).toBe(true);
      expect(fs.existsSync(path.join(vaultDir, 'vault.db'))).toBe(true);
      expect(fs.existsSync(path.join(vaultDir, 'audit.db'))).toBe(true);
      expect(fs.existsSync(path.join(vaultDir, 'master.pub'))).toBe(true);
    });

    it('stores a master public key file', () => {
      const pubKey = fs.readFileSync(path.join(vaultDir, 'master.pub'), 'utf-8');
      expect(pubKey.trim()).toMatch(/^age1/);
    });

    it('stores initial passphrase key', () => {
      const keys = engine.listKeys();
      expect(keys).toHaveLength(1);
      expect(keys[0].label).toBe('primary passphrase');
    });
  });

  // ── Write / Read ──────────────────────────────────────────────────

  describe('writeFile + readFile', () => {
    it('round-trip preserves content', async () => {
      const content = Buffer.from('Hello, encrypted world!');
      await engine.writeFile('notes/hello.txt', content, masterKey);
      const result = await engine.readFile('notes/hello.txt', masterKey);
      expect(result).toEqual(content);
    });

    it('writeFile creates metadata with correct fields', async () => {
      const content = Buffer.from('data');
      const meta = await engine.writeFile('test.bin', content, masterKey, ['binary']);
      expect(meta.vaultPath).toBe('test.bin');
      expect(meta.size).toBe(4);
      expect(meta.tags).toEqual(['binary']);
      expect(meta.id).toBeDefined();
      expect(meta.blobId).toBeDefined();
    });

    it('writeFile creates encrypted blob on disk', async () => {
      const content = Buffer.from('secret');
      const meta = await engine.writeFile('secret.txt', content, masterKey);
      const blobPath = path.join(vaultDir, 'files', `${meta.blobId}.age`);
      expect(fs.existsSync(blobPath)).toBe(true);
      // Blob should NOT contain plaintext
      const blob = fs.readFileSync(blobPath);
      expect(blob.toString('utf-8')).not.toContain('secret');
    });

    it('writeFile on existing path throws FileAlreadyExistsError', async () => {
      await engine.writeFile('dup.txt', Buffer.from('first'), masterKey);
      await expect(engine.writeFile('dup.txt', Buffer.from('second'), masterKey)).rejects.toThrow(
        FileAlreadyExistsError,
      );
    });

    it('readFile on non-existent file throws FileNotFoundError', async () => {
      await expect(engine.readFile('nonexistent.txt', masterKey)).rejects.toThrow(
        FileNotFoundError,
      );
    });
  });

  // ── Delete ────────────────────────────────────────────────────────

  describe('deleteFile', () => {
    it('removes blob and metadata', async () => {
      const meta = await engine.writeFile('delete-me.txt', Buffer.from('bye'), masterKey);
      const blobPath = path.join(vaultDir, 'files', `${meta.blobId}.age`);
      expect(fs.existsSync(blobPath)).toBe(true);

      await engine.deleteFile('delete-me.txt');
      expect(fs.existsSync(blobPath)).toBe(false);
      await expect(engine.readFile('delete-me.txt', masterKey)).rejects.toThrow(FileNotFoundError);
    });

    it('on non-existent file throws FileNotFoundError', async () => {
      await expect(engine.deleteFile('ghost.txt')).rejects.toThrow(FileNotFoundError);
    });
  });

  // ── List ──────────────────────────────────────────────────────────

  describe('listFiles', () => {
    it('returns all file metadata', async () => {
      await engine.writeFile('a.txt', Buffer.from('a'), masterKey);
      await engine.writeFile('b.txt', Buffer.from('b'), masterKey);
      const files = engine.listFiles();
      expect(files).toHaveLength(2);
      expect(files.map((f) => f.vaultPath).sort()).toEqual(['a.txt', 'b.txt']);
    });

    it('with directory prefix filters results', async () => {
      await engine.writeFile('docs/a.txt', Buffer.from('a'), masterKey);
      await engine.writeFile('other/b.txt', Buffer.from('b'), masterKey);
      const docs = engine.listFiles('docs');
      expect(docs).toHaveLength(1);
      expect(docs[0].vaultPath).toBe('docs/a.txt');
    });
  });

  // ── Search ────────────────────────────────────────────────────────

  describe('searchFiles', () => {
    it('matches filenames', async () => {
      await engine.writeFile('contracts/lease.pdf', Buffer.from('pdf'), masterKey);
      await engine.writeFile('notes/todo.md', Buffer.from('md'), masterKey);
      const results = engine.searchFiles('lease');
      expect(results).toHaveLength(1);
      expect(results[0].vaultPath).toBe('contracts/lease.pdf');
      expect(results[0].matchType).toBe('filename');
    });
  });

  // ── Grep ──────────────────────────────────────────────────────────

  describe('grepFiles', () => {
    it('finds content matches across files', async () => {
      await engine.writeFile('file1.txt', Buffer.from('line1\nfind me here\nline3'), masterKey);
      await engine.writeFile('file2.txt', Buffer.from('nothing interesting'), masterKey);
      const results = await engine.grepFiles('find me', masterKey);
      expect(results).toHaveLength(1);
      expect(results[0].vaultPath).toBe('file1.txt');
      expect(results[0].lineNumber).toBe(2);
      expect(results[0].line).toContain('find me here');
    });
  });

  // ── Key management ────────────────────────────────────────────────

  describe('addKey', () => {
    it('creates a new passphrase key', async () => {
      const record = await engine.addKey('second-passphrase-1234', 'backup key', masterKey);
      expect(record.label).toBe('backup key');
      expect(record.id).toBeDefined();
      expect(engine.listKeys()).toHaveLength(2);
    });
  });

  describe('unlock', () => {
    it('with original passphrase works', async () => {
      const key = await engine.unlock(TEST_PASSPHRASE);
      expect(key).toBe(masterKey);
    });

    it('with added key passphrase works', async () => {
      const secondPass = 'another-passphrase-5678';
      await engine.addKey(secondPass, 'second', masterKey);
      const key = await engine.unlock(secondPass);
      expect(key).toBe(masterKey);
    }, 30_000);

    it('with wrong passphrase throws InvalidKeyError', async () => {
      await expect(engine.unlock('wrong-passphrase-9999')).rejects.toThrow(InvalidKeyError);
    });
  });

  describe('revokeKey', () => {
    it('removes key', async () => {
      const second = await engine.addKey('second-passphrase-1234', 'second', masterKey);
      expect(engine.listKeys()).toHaveLength(2);
      engine.revokeKey(second.id);
      expect(engine.listKeys()).toHaveLength(1);
    });

    it('on last key throws LastKeyError', () => {
      const keys = engine.listKeys();
      expect(keys).toHaveLength(1);
      expect(() => engine.revokeKey(keys[0].id)).toThrow(LastKeyError);
    });

    it('on non-existent key throws KeyNotFoundError', () => {
      expect(() => engine.revokeKey('00000000-0000-0000-0000-000000000000')).toThrow(
        KeyNotFoundError,
      );
    });
  });

  // ── Status ────────────────────────────────────────────────────────

  describe('getStatus', () => {
    it('returns correct counts', async () => {
      await engine.writeFile('file.txt', Buffer.from('data'), masterKey);
      const status = engine.getStatus(true);
      expect(status.initialized).toBe(true);
      expect(status.locked).toBe(false);
      expect(status.fileCount).toBe(1);
      expect(status.keyCount).toBe(1);
    });

    it('reports locked when not unlocked', () => {
      const status = engine.getStatus(false);
      expect(status.locked).toBe(true);
    });
  });
});
