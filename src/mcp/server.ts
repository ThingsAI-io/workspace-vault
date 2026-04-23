import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { VaultEngine } from '../vault/index.js';
import { SessionManager } from '../session/index.js';
import { sanitizeOutput } from '../security/index.js';
import { VaultLockedError, SessionExpiredError, type FileMetadata } from '../types.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

const LOCKED_MESSAGE = 'Vault is locked. Run `vault unlock` in your terminal to unlock.';

function getMasterKey(session: SessionManager): string {
  try {
    return session.readSession();
  } catch (err) {
    if (err instanceof VaultLockedError || err instanceof SessionExpiredError) {
      throw new Error(LOCKED_MESSAGE, { cause: err });
    }
    throw err;
  }
}

function errorResult(message: string): CallToolResult {
  return {
    content: [{ type: 'text', text: `Error: ${message}` }],
    isError: true,
  };
}

function formatMetadata(files: FileMetadata[]): string {
  if (files.length === 0) return 'No files found.';

  return files
    .map((f) => {
      const tags = f.tags.length > 0 ? ` [${f.tags.join(', ')}]` : '';
      return `${f.vaultPath}  (${f.size} bytes, modified ${f.modifiedAt.toISOString()})${tags}`;
    })
    .join('\n');
}

export function createVaultMcpServer(engine: VaultEngine, session: SessionManager): McpServer {
  const server = new McpServer(
    { name: 'workspace-vault', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  // ── vault_read_file ──────────────────────────────────────────────────

  server.tool(
    'vault_read_file',
    'Read a file from the encrypted vault. Requires the vault to be unlocked.',
    { path: z.string().describe('Vault path of the file to read') },
    async ({ path: vaultPath }): Promise<CallToolResult> => {
      try {
        const masterKey = getMasterKey(session);
        const content = await engine.readFile(vaultPath, masterKey);
        return {
          content: [{ type: 'text', text: sanitizeOutput(content.toString('utf-8')) }],
        };
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );

  // ── vault_create_file ────────────────────────────────────────────────

  server.tool(
    'vault_create_file',
    'Create a new encrypted file in the vault. Requires the vault to be unlocked.',
    {
      path: z.string().describe('Vault path for the new file'),
      content: z.string().describe('File content to encrypt and store'),
      tags: z.array(z.string()).optional().describe('Optional tags for the file'),
    },
    async ({ path: vaultPath, content, tags }): Promise<CallToolResult> => {
      try {
        const masterKey = getMasterKey(session);
        const meta = await engine.writeFile(
          vaultPath,
          Buffer.from(content, 'utf-8'),
          masterKey,
          tags,
        );
        return {
          content: [
            {
              type: 'text',
              text: sanitizeOutput(
                `Created ${meta.vaultPath} (${meta.size} bytes, id: ${meta.id})`,
              ),
            },
          ],
        };
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );

  // ── vault_list_dir ───────────────────────────────────────────────────

  server.tool(
    'vault_list_dir',
    'List files in the vault. Shows metadata (names, sizes, dates, tags). Works even when the vault is locked.',
    {
      path: z.string().optional().describe('Optional directory prefix to filter by'),
    },
    ({ path: dirPath }): CallToolResult => {
      try {
        const files = engine.listFiles(dirPath);
        return {
          content: [{ type: 'text', text: sanitizeOutput(formatMetadata(files)) }],
        };
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );

  // ── vault_grep_search ────────────────────────────────────────────────

  server.tool(
    'vault_grep_search',
    'Search file contents in the vault using a pattern. Requires the vault to be unlocked.',
    { pattern: z.string().describe('Search pattern (regex supported)') },
    async ({ pattern }): Promise<CallToolResult> => {
      try {
        const masterKey = getMasterKey(session);
        const results = await engine.grepFiles(pattern, masterKey);
        if (results.length === 0) {
          return { content: [{ type: 'text', text: 'No matches found.' }] };
        }
        const text = results
          .map((r) => `${r.vaultPath}:${r.lineNumber}: ${sanitizeOutput(r.line)}`)
          .join('\n');
        return { content: [{ type: 'text', text }] };
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );

  // ── vault_file_search ────────────────────────────────────────────────

  server.tool(
    'vault_file_search',
    'Search for files by name or tag in the vault. Works even when the vault is locked.',
    { query: z.string().describe('Search query for filenames or tags') },
    ({ query }): CallToolResult => {
      try {
        const results = engine.searchFiles(query);
        if (results.length === 0) {
          return { content: [{ type: 'text', text: 'No matches found.' }] };
        }
        const text = results
          .map((r) => `${r.vaultPath} (${r.matchType}: ${sanitizeOutput(r.matchedValue)})`)
          .join('\n');
        return { content: [{ type: 'text', text }] };
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );

  return server;
}
