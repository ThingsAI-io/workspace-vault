# MCP Tools Reference

The workspace-vault MCP server exposes five tools to AI agents. These tools mirror standard file operations so agents can work with the vault naturally.

## Setup

Add to your MCP client config:

```json
{
  "mcpServers": {
    "workspace-vault": {
      "command": "vault",
      "args": ["mcp"]
    }
  }
}
```

The server communicates over **stdio** using the [Model Context Protocol](https://modelcontextprotocol.io/).

---

## Tools

### `vault_read_file`

Read and decrypt a file from the vault.

**Parameters:**
| Name | Type | Required | Description |
|------|------|:---:|-------------|
| `path` | string | Yes | Vault path of the file to read |

**Returns:** Decrypted file content as text.

**Requires unlock:** Yes

**Example:**
```json
{ "tool": "vault_read_file", "arguments": { "path": "contracts/nda.pdf" } }
```

**When locked:** Returns an error with guidance: `"Vault is locked. Run 'vault unlock' in your terminal to unlock."`

---

### `vault_create_file`

Create a new encrypted file in the vault.

**Parameters:**
| Name | Type | Required | Description |
|------|------|:---:|-------------|
| `path` | string | Yes | Vault path for the new file |
| `content` | string | Yes | File content to encrypt and store |
| `tags` | string[] | No | Tags for the file |

**Returns:** Confirmation with path, size, and file ID.

**Requires unlock:** Yes

**Example:**
```json
{
  "tool": "vault_create_file",
  "arguments": {
    "path": "notes/meeting-2025-04-22.md",
    "content": "# Meeting Notes\n\n- Discussed Q2 roadmap...",
    "tags": ["meeting", "2025"]
  }
}
```

---

### `vault_list_dir`

List files in the vault with metadata.

**Parameters:**
| Name | Type | Required | Description |
|------|------|:---:|-------------|
| `path` | string | No | Directory prefix to filter by |

**Returns:** List of files with vault path, size, modification date, and tags.

**Requires unlock:** No — works while locked. Shows metadata only, never content.

**Example:**
```json
{ "tool": "vault_list_dir", "arguments": { "path": "contracts" } }
```

---

### `vault_grep_search`

Search file contents using a pattern (regex supported).

**Parameters:**
| Name | Type | Required | Description |
|------|------|:---:|-------------|
| `pattern` | string | Yes | Search pattern |

**Returns:** Matching lines with file path and line number.

**Requires unlock:** Yes — decrypts files to search their content.

**Example:**
```json
{ "tool": "vault_grep_search", "arguments": { "pattern": "Acme Corp" } }
```

**Output format:**
```
contracts/nda.pdf:12: This agreement between Acme Corp and...
contracts/nda.pdf:47: Acme Corp shall not disclose...
```

---

### `vault_file_search`

Search for files by filename or tag.

**Parameters:**
| Name | Type | Required | Description |
|------|------|:---:|-------------|
| `query` | string | Yes | Search query for filenames or tags |

**Returns:** Matching files with match type (filename or tag) and matched value.

**Requires unlock:** No — searches metadata only.

**Example:**
```json
{ "tool": "vault_file_search", "arguments": { "query": "medical" } }
```

**Output format:**
```
medical/lab-results.pdf (filename: lab-results.pdf)
finances/insurance.pdf (tag: medical)
```

---

## Locked vs. unlocked behavior

| Tool | Locked | Unlocked |
|------|--------|----------|
| `vault_list_dir` | ✅ Returns metadata | ✅ Returns metadata |
| `vault_file_search` | ✅ Searches metadata | ✅ Searches metadata |
| `vault_read_file` | ❌ Error: vault locked | ✅ Returns content |
| `vault_create_file` | ❌ Error: vault locked | ✅ Creates file |
| `vault_grep_search` | ❌ Error: vault locked | ✅ Searches content |

When a tool requires unlock and the vault is locked, it returns a clear error:

```
Error: Vault is locked. Run `vault unlock` in your terminal to unlock.
```

This is returned as an MCP error result (`isError: true`), so agents can handle it gracefully — for example, by asking the user to unlock.

## Security notes

- The MCP server **cannot** unlock the vault — only the CLI can
- The MCP server **cannot** manage keys, view audit logs, or initialize the vault
- All file content returned by the MCP server is sanitized (ANSI escape codes and control characters stripped)
- All operations are recorded in the audit log
