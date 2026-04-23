import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { VaultEngine } from '../../src/vault/engine.js';
import { SessionManager } from '../../src/session/manager.js';
import { ConfigManager } from '../../src/config/index.js';
import { createVaultMcpServer } from '../../src/mcp/server.js';
import {
  OperationType,
  VaultLockedError,
  FileNotFoundError,
  FileAlreadyExistsError,
  InvalidKeyError,
  LastKeyError,
  PathTraversalError,
  SessionExpiredError,
} from '../../src/types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

const TEST_PASSPHRASE = 'integration-test-passphrase-1';
const TEST_PASSPHRASE_2 = 'integration-test-passphrase-2';

async function callTool(
  server: McpServer,
  name: string,
  args: Record<string, unknown> = {},
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const registeredTools = (server as any)._registeredTools;
  const tool = registeredTools[name];
  if (!tool) throw new Error(`Tool ${name} not found`);
  const extra = { signal: new AbortController().signal };
  const result = await tool.handler(args, extra);
  return result as { content: Array<{ type: string; text: string }>; isError?: boolean };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('Integration: Full vault lifecycle', { timeout: 60_000 }, () => {
  const dirs: string[] = [];
  const engines: VaultEngine[] = [];

  afterEach(() => {
    for (const e of engines) {
      try {
        e.close();
      } catch {
        /* already closed */
      }
    }
    engines.length = 0;
    for (const d of dirs) cleanup(d);
    dirs.length = 0;
  });

  function trackDir(): string {
    const d = makeTempDir('vault-integ-');
    dirs.push(d);
    return d;
  }

  function trackEngine(e: VaultEngine): VaultEngine {
    engines.push(e);
    return e;
  }

  // ── 1. Full lifecycle ──────────────────────────────────────────────

  it('init → unlock → write → read → lock → verify locked → unlock → read', async () => {
    const tmpDir = trackDir();
    const vaultDir = path.join(tmpDir, 'vault');

    // Init
    const engine = trackEngine(await VaultEngine.init(vaultDir, TEST_PASSPHRASE));

    // Unlock
    const masterKey = await engine.unlock(TEST_PASSPHRASE);
    expect(masterKey).toBeTruthy();
    expect(typeof masterKey).toBe('string');

    // Write
    const content = Buffer.from('Secret document content');
    const meta = await engine.writeFile('docs/secret.txt', content, masterKey, ['private']);
    expect(meta.vaultPath).toBe('docs/secret.txt');
    expect(meta.size).toBe(content.length);
    expect(meta.tags).toEqual(['private']);

    // Read
    const readBack = await engine.readFile('docs/secret.txt', masterKey);
    expect(readBack.toString('utf-8')).toBe('Secret document content');

    // Session lock/unlock cycle
    const sessionPath = path.join(tmpDir, 'session');
    const session = new SessionManager(sessionPath);

    session.writeSession(masterKey, 30);
    expect(session.isUnlocked()).toBe(true);
    expect(session.readSession()).toBe(masterKey);

    session.clearSession();
    expect(session.isUnlocked()).toBe(false);
    expect(() => session.readSession()).toThrow(VaultLockedError);

    // Unlock again and verify readable
    const masterKey2 = await engine.unlock(TEST_PASSPHRASE);
    expect(masterKey2).toBe(masterKey);
    const readBack2 = await engine.readFile('docs/secret.txt', masterKey2);
    expect(readBack2.toString('utf-8')).toBe('Secret document content');
  });

  // ── 2. Multi-file operations ───────────────────────────────────────

  it('write multiple files → list → search by name → search by tag → grep content', async () => {
    const tmpDir = trackDir();
    const vaultDir = path.join(tmpDir, 'vault');
    const engine = trackEngine(await VaultEngine.init(vaultDir, TEST_PASSPHRASE));
    const masterKey = await engine.unlock(TEST_PASSPHRASE);

    // Write multiple files
    await engine.writeFile(
      'src/main.ts',
      Buffer.from('export function main() { return 42; }'),
      masterKey,
      ['typescript', 'entry'],
    );
    await engine.writeFile(
      'src/utils.ts',
      Buffer.from('export function add(a: number, b: number) { return a + b; }'),
      masterKey,
      ['typescript', 'utils'],
    );
    await engine.writeFile(
      'docs/readme.md',
      Buffer.from('# Project\nThis is the readme file.'),
      masterKey,
      ['documentation'],
    );
    await engine.writeFile('config.json', Buffer.from('{"port": 3000}'), masterKey, ['config']);

    // List all
    const allFiles = engine.listFiles();
    expect(allFiles).toHaveLength(4);

    // List by prefix
    const srcFiles = engine.listFiles('src');
    expect(srcFiles).toHaveLength(2);
    expect(srcFiles.map((f) => f.vaultPath)).toContain('src/main.ts');
    expect(srcFiles.map((f) => f.vaultPath)).toContain('src/utils.ts');

    // Search by name
    const nameResults = engine.searchFiles('readme');
    expect(nameResults.length).toBeGreaterThanOrEqual(1);
    expect(nameResults[0].vaultPath).toBe('docs/readme.md');

    // Search by tag (tags stored as JSON, search uses LIKE on tags column)
    const tagResults = engine.searchFiles('typescript');
    expect(tagResults.length).toBeGreaterThanOrEqual(2);

    // Grep content
    const grepResults = await engine.grepFiles('function', masterKey);
    expect(grepResults.length).toBeGreaterThanOrEqual(2);
    const grepPaths = grepResults.map((r) => r.vaultPath);
    expect(grepPaths).toContain('src/main.ts');
    expect(grepPaths).toContain('src/utils.ts');

    // Grep with specific pattern
    const grepPort = await engine.grepFiles('3000', masterKey);
    expect(grepPort).toHaveLength(1);
    expect(grepPort[0].vaultPath).toBe('config.json');
    expect(grepPort[0].line).toContain('3000');
  });

  // ── 3. Key management ─────────────────────────────────────────────

  it('add second key → unlock with it → revoke first → verify', async () => {
    const tmpDir = trackDir();
    const vaultDir = path.join(tmpDir, 'vault');
    const engine = trackEngine(await VaultEngine.init(vaultDir, TEST_PASSPHRASE));
    const masterKey = await engine.unlock(TEST_PASSPHRASE);

    // List keys: should have 1
    const initialKeys = engine.listKeys();
    expect(initialKeys).toHaveLength(1);
    expect(initialKeys[0].label).toBe('primary passphrase');
    const firstKeyId = initialKeys[0].id;

    // Add second key
    const newKey = await engine.addKey(TEST_PASSPHRASE_2, 'backup key', masterKey);
    expect(newKey.label).toBe('backup key');
    expect(engine.listKeys()).toHaveLength(2);

    // Unlock with second key
    const masterKey2 = await engine.unlock(TEST_PASSPHRASE_2);
    expect(masterKey2).toBe(masterKey);

    // Revoke first key
    engine.revokeKey(firstKeyId);
    expect(engine.listKeys()).toHaveLength(1);

    // First passphrase no longer works
    await expect(engine.unlock(TEST_PASSPHRASE)).rejects.toThrow(InvalidKeyError);

    // Second passphrase still works
    const masterKey3 = await engine.unlock(TEST_PASSPHRASE_2);
    expect(masterKey3).toBe(masterKey);

    // Can't revoke the last key
    const remainingKeyId = engine.listKeys()[0].id;
    expect(() => engine.revokeKey(remainingKeyId)).toThrow(LastKeyError);
  });

  // ── 4. Session expiry ─────────────────────────────────────────────

  it('session expires after TTL', async () => {
    const tmpDir = trackDir();
    const sessionPath = path.join(tmpDir, 'session');
    const session = new SessionManager(sessionPath);

    // Write session with 30-min TTL (works normally)
    session.writeSession('fake-master-key-hex', 30);
    expect(session.isUnlocked()).toBe(true);
    expect(session.readSession()).toBe('fake-master-key-hex');

    const info = session.getSessionInfo();
    expect(info).not.toBeNull();
    expect(info!.expiresAt.getTime()).toBeGreaterThan(Date.now());

    // Manipulate session file to be expired
    const raw = fs.readFileSync(sessionPath, 'utf-8');
    const data = JSON.parse(raw);
    data.expiresAt = new Date(Date.now() - 1000).toISOString();
    fs.writeFileSync(sessionPath, JSON.stringify(data), 'utf-8');

    // Should now throw SessionExpiredError
    expect(() => session.readSession()).toThrow(SessionExpiredError);
    expect(session.isUnlocked()).toBe(false);

    // Session file should be cleaned up
    expect(fs.existsSync(sessionPath)).toBe(false);
  });

  // ── 5. MCP server integration ─────────────────────────────────────

  it('MCP server tools work end-to-end', async () => {
    const tmpDir = trackDir();
    const vaultDir = path.join(tmpDir, 'vault');
    const sessionPath = path.join(tmpDir, 'session');

    const engine = trackEngine(await VaultEngine.init(vaultDir, TEST_PASSPHRASE));
    const masterKey = await engine.unlock(TEST_PASSPHRASE);
    const session = new SessionManager(sessionPath);
    const server = createVaultMcpServer(engine, session);

    // ── Locked: vault_list_dir and vault_file_search work
    const listLocked = await callTool(server, 'vault_list_dir');
    expect(listLocked.isError).toBeFalsy();

    // ── Locked: read/create/grep fail
    const readLocked = await callTool(server, 'vault_read_file', { path: 'test.txt' });
    expect(readLocked.isError).toBe(true);
    expect(readLocked.content[0].text).toContain('vault unlock');

    const createLocked = await callTool(server, 'vault_create_file', {
      path: 'x.txt',
      content: 'hi',
    });
    expect(createLocked.isError).toBe(true);

    const grepLocked = await callTool(server, 'vault_grep_search', { pattern: 'test' });
    expect(grepLocked.isError).toBe(true);

    // ── Unlock
    session.writeSession(masterKey, 30);

    // vault_create_file
    const createResult = await callTool(server, 'vault_create_file', {
      path: 'notes/todo.md',
      content: '- Buy milk\n- Write tests',
      tags: ['note', 'todo'],
    });
    expect(createResult.isError).toBeFalsy();
    expect(createResult.content[0].text).toContain('Created notes/todo.md');

    // vault_read_file
    const readResult = await callTool(server, 'vault_read_file', { path: 'notes/todo.md' });
    expect(readResult.isError).toBeFalsy();
    expect(readResult.content[0].text).toContain('Buy milk');

    // vault_list_dir
    const listResult = await callTool(server, 'vault_list_dir');
    expect(listResult.isError).toBeFalsy();
    expect(listResult.content[0].text).toContain('notes/todo.md');

    // vault_file_search
    const searchResult = await callTool(server, 'vault_file_search', { query: 'todo' });
    expect(searchResult.isError).toBeFalsy();
    expect(searchResult.content[0].text).toContain('notes/todo.md');

    // vault_grep_search
    const grepResult = await callTool(server, 'vault_grep_search', { pattern: 'milk' });
    expect(grepResult.isError).toBeFalsy();
    expect(grepResult.content[0].text).toContain('notes/todo.md');
    expect(grepResult.content[0].text).toContain('Buy milk');
  });

  // ── 6. Audit log completeness ─────────────────────────────────────

  it('audit log records all operations', async () => {
    const tmpDir = trackDir();
    const vaultDir = path.join(tmpDir, 'vault');

    const engine = trackEngine(await VaultEngine.init(vaultDir, TEST_PASSPHRASE));
    const audit = engine.getAuditLogger();

    // Init event already logged
    const initEvents = audit.getEvents({ operation: OperationType.INIT });
    expect(initEvents).toHaveLength(1);
    expect(initEvents[0].success).toBe(true);

    // Unlock
    const masterKey = await engine.unlock(TEST_PASSPHRASE);
    const unlockEvents = audit.getEvents({ operation: OperationType.UNLOCK });
    expect(unlockEvents.length).toBeGreaterThanOrEqual(1);
    expect(unlockEvents[0].success).toBe(true);

    // Write
    await engine.writeFile('test.txt', Buffer.from('hello'), masterKey);
    const writeEvents = audit.getEvents({ operation: OperationType.WRITE });
    expect(writeEvents).toHaveLength(1);
    expect(writeEvents[0].targetPath).toBe('test.txt');

    // Read
    await engine.readFile('test.txt', masterKey);
    const readEvents = audit.getEvents({ operation: OperationType.READ });
    expect(readEvents).toHaveLength(1);

    // List
    engine.listFiles();
    const listEvents = audit.getEvents({ operation: OperationType.LIST });
    expect(listEvents).toHaveLength(1);

    // Search
    engine.searchFiles('test');
    const searchEvents = audit.getEvents({ operation: OperationType.SEARCH });
    expect(searchEvents).toHaveLength(1);

    // Grep
    await engine.grepFiles('hello', masterKey);
    const grepEvents = audit.getEvents({ operation: OperationType.GREP });
    expect(grepEvents).toHaveLength(1);

    // Delete
    await engine.deleteFile('test.txt');
    const deleteEvents = audit.getEvents({ operation: OperationType.DELETE });
    expect(deleteEvents).toHaveLength(1);
    expect(deleteEvents[0].targetPath).toBe('test.txt');

    // Key add
    const newKey = await engine.addKey(TEST_PASSPHRASE_2, 'second', masterKey);
    const keyAddEvents = audit.getEvents({ operation: OperationType.KEY_ADD });
    expect(keyAddEvents).toHaveLength(1);
    expect(keyAddEvents[0].keyId).toBe(newKey.id);

    // Key revoke
    engine.revokeKey(newKey.id);
    const keyRevokeEvents = audit.getEvents({ operation: OperationType.KEY_REVOKE });
    expect(keyRevokeEvents).toHaveLength(1);
    expect(keyRevokeEvents[0].keyId).toBe(newKey.id);

    // Total events
    const total = audit.getEventCount();
    expect(total).toBeGreaterThanOrEqual(10);
  });

  // ── 7. Security: path traversal ───────────────────────────────────

  it('rejects path traversal attempts', async () => {
    const tmpDir = trackDir();
    const vaultDir = path.join(tmpDir, 'vault');
    const engine = trackEngine(await VaultEngine.init(vaultDir, TEST_PASSPHRASE));
    const masterKey = await engine.unlock(TEST_PASSPHRASE);

    const maliciousPaths = [
      '../outside.txt',
      '../../etc/passwd',
      'docs/../../outside.txt',
      path.resolve('/etc/passwd'),
      'file\0name.txt',
    ];

    for (const p of maliciousPaths) {
      await expect(engine.writeFile(p, Buffer.from('bad'), masterKey)).rejects.toThrow();
      await expect(engine.readFile(p, masterKey)).rejects.toThrow();
    }
  });

  // ── 8. Delete + re-create ─────────────────────────────────────────

  it('delete file then re-create at same path', async () => {
    const tmpDir = trackDir();
    const vaultDir = path.join(tmpDir, 'vault');
    const engine = trackEngine(await VaultEngine.init(vaultDir, TEST_PASSPHRASE));
    const masterKey = await engine.unlock(TEST_PASSPHRASE);

    // Write
    await engine.writeFile('data.txt', Buffer.from('version 1'), masterKey);
    const v1 = await engine.readFile('data.txt', masterKey);
    expect(v1.toString('utf-8')).toBe('version 1');

    // Delete
    await engine.deleteFile('data.txt');
    await expect(engine.readFile('data.txt', masterKey)).rejects.toThrow(FileNotFoundError);
    expect(engine.listFiles()).toHaveLength(0);

    // Re-create
    const meta2 = await engine.writeFile('data.txt', Buffer.from('version 2'), masterKey, ['v2']);
    expect(meta2.tags).toEqual(['v2']);
    const v2 = await engine.readFile('data.txt', masterKey);
    expect(v2.toString('utf-8')).toBe('version 2');
  });

  // ── 9. Overwrite (duplicate path) ─────────────────────────────────

  it('writing to existing path throws FileAlreadyExistsError', async () => {
    const tmpDir = trackDir();
    const vaultDir = path.join(tmpDir, 'vault');
    const engine = trackEngine(await VaultEngine.init(vaultDir, TEST_PASSPHRASE));
    const masterKey = await engine.unlock(TEST_PASSPHRASE);

    await engine.writeFile('dup.txt', Buffer.from('first'), masterKey);
    await expect(engine.writeFile('dup.txt', Buffer.from('second'), masterKey)).rejects.toThrow(
      FileAlreadyExistsError,
    );

    // Original content preserved
    const content = await engine.readFile('dup.txt', masterKey);
    expect(content.toString('utf-8')).toBe('first');
  });

  // ── 10. Empty vault ───────────────────────────────────────────────

  it('list/search/grep on empty vault returns empty results', async () => {
    const tmpDir = trackDir();
    const vaultDir = path.join(tmpDir, 'vault');
    const engine = trackEngine(await VaultEngine.init(vaultDir, TEST_PASSPHRASE));
    const masterKey = await engine.unlock(TEST_PASSPHRASE);

    expect(engine.listFiles()).toEqual([]);
    expect(engine.listFiles('nonexistent')).toEqual([]);
    expect(engine.searchFiles('anything')).toEqual([]);

    const grepResults = await engine.grepFiles('pattern', masterKey);
    expect(grepResults).toEqual([]);

    // Status reflects empty vault
    const status = engine.getStatus(true);
    expect(status.initialized).toBe(true);
    expect(status.locked).toBe(false);
    expect(status.fileCount).toBe(0);
    expect(status.keyCount).toBe(1);
  });

  // ── ConfigManager integration ─────────────────────────────────────

  it('ConfigManager works with custom config dir', () => {
    const tmpDir = trackDir();
    const configDir = path.join(tmpDir, 'config');
    const vaultDir = path.join(tmpDir, 'vault');

    const config = new ConfigManager(configDir);
    expect(config.isInitialized()).toBe(false);

    const savedConfig = config.initialize(vaultDir);
    expect(savedConfig.vaultPath).toBe(path.resolve(vaultDir));
    expect(config.isInitialized()).toBe(true);
    expect(config.getVaultPath()).toBe(path.resolve(vaultDir));
    expect(config.getSessionPath()).toContain('session');
  });
});
