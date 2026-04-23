# CLI Reference

## Global options

```
vault --version    Show version number
vault --help       Show help
vault <cmd> --help Show help for a specific command
```

---

## Vault management

### `vault init [path]`

Initialize a new encrypted vault.

```bash
vault init              # Creates vault at ~/.vault
vault init ~/my-vault   # Creates vault at custom path
```

Prompts for a passphrase (with confirmation). Creates the vault directory, generates the master key, and stores your config.

After init, prints an MCP config snippet you can paste into your agent's settings.

### `vault unlock`

Unlock the vault for the current session.

```bash
vault unlock
```

Prompts for your passphrase. On success, creates a session that lasts 30 minutes. The MCP server can access file content while the session is active.

If the vault is already unlocked, this is a no-op.

### `vault lock`

Lock the vault immediately.

```bash
vault lock
```

Clears the session. The MCP server will return "vault is locked" errors until you unlock again.

### `vault status`

Show vault status.

```bash
vault status
```

Output includes:
- Lock state (locked/unlocked)
- Number of stored files
- Number of authorized keys
- Session expiry time (if unlocked)

---

## File operations

### `vault write <vault-path>`

Write a file to the vault.

```bash
# From a local file
vault write notes/todo.md --from ~/todo.md

# With tags
vault write medical/labs.pdf --from ~/labs.pdf --tag medical --tag 2025

# From stdin
echo "secret content" | vault write secrets/api-key.txt
cat report.pdf | vault write reports/q4.pdf
```

**Options:**
- `--from <file>` — read content from a local file (otherwise reads stdin)
- `--tag <tag...>` — one or more tags for the file

Requires the vault to be unlocked.

### `vault read <vault-path>`

Read and decrypt a file from the vault.

```bash
vault read contracts/nda.pdf
vault read contracts/nda.pdf > ~/Desktop/nda.pdf
```

Outputs decrypted content to stdout. Requires unlock.

### `vault delete <vault-path>`

Delete a file from the vault.

```bash
vault delete old/draft.md
```

Removes both the encrypted blob and metadata. Requires unlock.

### `vault list [vault-path]`

List files in the vault.

```bash
vault list                # List all files
vault list contracts/     # List files under contracts/
```

Shows path, size, modified date, and tags. **Works while locked** — only shows metadata, not content.

### `vault search <query>`

Search for files by filename or tag.

```bash
vault search nda
vault search medical
```

Returns matching files with the match type (filename or tag). **Works while locked.**

### `vault grep <pattern>`

Search file contents using a regex pattern.

```bash
vault grep "Acme Corp"
vault grep "API_KEY=.*"
```

Returns matching lines with file path and line number. Requires unlock (decrypts files to search).

---

## Key management

### `vault key add`

Add a new passphrase key to the vault.

```bash
vault key add
```

Prompts for:
1. A new passphrase (with confirmation)
2. A label for the key (e.g., "backup", "work-laptop")

The new key can independently unlock the vault. Requires the vault to be currently unlocked.

### `vault key list`

List all authorized keys.

```bash
vault key list
```

Shows key ID, label, and creation date.

### `vault key revoke <key-id>`

Revoke an authorized key.

```bash
vault key revoke a1b2c3d4-...
```

Removes the key's ability to unlock the vault. Cannot revoke the last remaining key.

---

## Audit

### `vault audit`

View the audit log.

```bash
vault audit                    # Show all events
vault audit --tail 20          # Show last 20 events
vault audit --operation read   # Filter by operation type
```

**Options:**
- `--tail <n>` — show only the last N events
- `--operation <type>` — filter by operation type (`read`, `write`, `delete`, `search`, `grep`, `list`, `unlock`, `lock`, `init`, `key_add`, `key_revoke`)

Shows timestamp, operation, target path, and success/failure status. **File content is never logged.**

---

## MCP server

### `vault mcp`

Start the MCP server over stdio.

```bash
vault mcp
```

This is typically not run directly — it's invoked by your MCP client (VS Code, Claude Desktop, etc.) as configured in the MCP settings. See the [MCP Tools Reference](mcp.md) for the tools exposed to agents.
