import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { VaultEngine } from '../../src/vault/engine.js';
import { SessionManager } from '../../src/session/manager.js';
import { createVaultMcpServer } from '../../src/mcp/server.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
}

function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

/**
 * Call a tool on the McpServer by accessing its internal registered tools.
 * This avoids needing a full MCP transport for unit tests.
 */
async function callTool(
  server: McpServer,
  name: string,
  args: Record<string, unknown> = {},
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  // Access internal registered tools via the server's underlying Server
  // We use the McpServer's tool registry via private _registeredTools
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const registeredTools = (server as any)._registeredTools;
  const tool = registeredTools[name];
  if (!tool) {
    throw new Error(`Tool ${name} not found`);
  }

  // The handler is the callback function; call it with args and a minimal extra object
  const extra = { signal: new AbortController().signal };
  const result = await tool.handler(args, extra);
  return result as { content: Array<{ type: string; text: string }>; isError?: boolean };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('MCP Server', () => {
  let tmpDir: string;
  let vaultDir: string;
  let sessionPath: string;
  let engine: VaultEngine;
  let session: SessionManager;
  let server: McpServer;
  let masterKey: string;

  const TEST_PASSPHRASE = 'test-passphrase-long-enough';

  beforeEach(async () => {
    tmpDir = makeTempDir();
    vaultDir = path.join(tmpDir, 'vault');
    sessionPath = path.join(tmpDir, 'session');

    // Initialize a vault with a test passphrase
    engine = await VaultEngine.init(vaultDir, TEST_PASSPHRASE);
    masterKey = await engine.unlock(TEST_PASSPHRASE);

    session = new SessionManager(sessionPath);
    server = createVaultMcpServer(engine, session);

    // Write a test file into the vault
    await engine.writeFile(
      'docs/readme.md',
      Buffer.from('# Hello World\nThis is a test file.'),
      masterKey,
      ['doc', 'readme'],
    );
    await engine.writeFile('secrets/api-key.txt', Buffer.from('sk-secret-key-12345'), masterKey, [
      'secret',
    ]);
  });

  afterEach(() => {
    engine.close();
    cleanup(tmpDir);
  });

  // ── Helper to unlock/lock ──────────────────────────────────────────

  function unlockVault(): void {
    session.writeSession(masterKey, 30);
  }

  function lockVault(): void {
    session.clearSession();
  }

  // ── vault_list_dir ─────────────────────────────────────────────────

  describe('vault_list_dir', () => {
    it('lists files while locked (no session file)', async () => {
      lockVault();
      const result = await callTool(server, 'vault_list_dir');
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain('docs/readme.md');
      expect(result.content[0].text).toContain('secrets/api-key.txt');
    });

    it('lists files while unlocked', async () => {
      unlockVault();
      const result = await callTool(server, 'vault_list_dir');
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain('docs/readme.md');
      expect(result.content[0].text).toContain('secrets/api-key.txt');
    });

    it('filters by directory prefix', async () => {
      const result = await callTool(server, 'vault_list_dir', {
        path: 'docs',
      });
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain('docs/readme.md');
      expect(result.content[0].text).not.toContain('secrets/api-key.txt');
    });
  });

  // ── vault_file_search ──────────────────────────────────────────────

  describe('vault_file_search', () => {
    it('searches filenames while locked', async () => {
      lockVault();
      const result = await callTool(server, 'vault_file_search', {
        query: 'readme',
      });
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain('docs/readme.md');
    });

    it('returns no matches for unknown query', async () => {
      const result = await callTool(server, 'vault_file_search', {
        query: 'nonexistent',
      });
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain('No matches found.');
    });
  });

  // ── vault_read_file ────────────────────────────────────────────────

  describe('vault_read_file', () => {
    it('reads file content when unlocked', async () => {
      unlockVault();
      const result = await callTool(server, 'vault_read_file', {
        path: 'docs/readme.md',
      });
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain('# Hello World');
      expect(result.content[0].text).toContain('This is a test file.');
    });

    it('returns locked error when vault is locked', async () => {
      lockVault();
      const result = await callTool(server, 'vault_read_file', {
        path: 'docs/readme.md',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('vault unlock');
    });

    it('returns not found error for missing file', async () => {
      unlockVault();
      const result = await callTool(server, 'vault_read_file', {
        path: 'nonexistent.txt',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('not found');
    });
  });

  // ── vault_create_file ──────────────────────────────────────────────

  describe('vault_create_file', () => {
    it('creates file when unlocked', async () => {
      unlockVault();
      const result = await callTool(server, 'vault_create_file', {
        path: 'notes/todo.md',
        content: '- Buy groceries',
        tags: ['note'],
      });
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain('Created notes/todo.md');

      // Verify the file is readable
      const readResult = await callTool(server, 'vault_read_file', {
        path: 'notes/todo.md',
      });
      expect(readResult.content[0].text).toContain('Buy groceries');
    });

    it('returns locked error when vault is locked', async () => {
      lockVault();
      const result = await callTool(server, 'vault_create_file', {
        path: 'notes/todo.md',
        content: '- Buy groceries',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('vault unlock');
    });
  });

  // ── vault_grep_search ──────────────────────────────────────────────

  describe('vault_grep_search', () => {
    it('searches content when unlocked', async () => {
      unlockVault();
      const result = await callTool(server, 'vault_grep_search', {
        pattern: 'Hello',
      });
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain('docs/readme.md');
      expect(result.content[0].text).toContain('Hello World');
    });

    it('returns locked error when vault is locked', async () => {
      lockVault();
      const result = await callTool(server, 'vault_grep_search', {
        pattern: 'Hello',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('vault unlock');
    });

    it('returns no matches message when pattern not found', async () => {
      unlockVault();
      const result = await callTool(server, 'vault_grep_search', {
        pattern: 'zzz_nonexistent_pattern',
      });
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain('No matches found.');
    });
  });
});
