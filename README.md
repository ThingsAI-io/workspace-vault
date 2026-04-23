# Workspace Vault

An encrypted file vault with CLI and MCP server that gives AI agents controlled access to your private files.

Files are encrypted at rest using [age](https://age-encryption.org/). You control when the vault is unlocked. Your agent works with files through standard operations — read, write, search, list — and when the session ends, everything locks again.

## Quickstart

```bash
# Install
npm install -g workspace-vault

# Initialize a vault (you'll set a passphrase)
vault init

# Store a file
vault write contracts/nda.pdf --from ~/Documents/nda.pdf

# Unlock so your agent can access files
vault unlock

# Check status
vault status
```

### Connect to your AI agent

After `vault init`, add this to your MCP client config:

**VS Code / Copilot** (`.vscode/mcp.json`):
```json
{
  "servers": {
    "workspace-vault": {
      "command": "vault",
      "args": ["mcp"]
    }
  }
}
```

**Claude Desktop** (`claude_desktop_config.json`):
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

That's it. Your agent can now read, write, search, and list vault files — as long as you've unlocked the vault.

## How it works

1. **You** initialize the vault and set a passphrase
2. **You** store files into the vault (they're encrypted immediately)
3. **You** unlock the vault when you want your agent to have access
4. **Your agent** reads, writes, and searches files through MCP tools
5. The vault **auto-locks** after 30 minutes (configurable) or when you run `vault lock`

The agent never sees the passphrase. It never self-authorizes. All access is audited.

## Documentation

- **[Quickstart Guide](docs/quickstart.md)** — full setup walkthrough
- **[CLI Reference](docs/cli.md)** — all commands and options
- **[MCP Tools Reference](docs/mcp.md)** — tools available to AI agents
- **[Security Model](spec/security.md)** — encryption, threat model, design decisions

## CLI overview

```
vault init [path]           Initialize a new vault
vault unlock                Unlock the vault (passphrase prompt)
vault lock                  Lock the vault
vault status                Show vault status

vault write <path>          Write a file (--from <file> or stdin)
vault read <path>           Read and decrypt a file
vault delete <path>         Delete a file
vault list [path]           List files (works while locked)
vault search <query>        Search by filename or tag
vault grep <pattern>        Search file contents (requires unlock)

vault key add               Add a new passphrase key
vault key list              List authorized keys
vault key revoke <key-id>   Revoke a key

vault audit                 View the audit log
vault mcp                   Start the MCP server
```

## MCP tools

| Tool | Description | Requires unlock |
|------|-------------|:---:|
| `vault_read_file` | Read and decrypt a file | Yes |
| `vault_create_file` | Create an encrypted file | Yes |
| `vault_grep_search` | Search file contents by pattern | Yes |
| `vault_list_dir` | List files and metadata | No |
| `vault_file_search` | Search by filename or tag | No |

## Security

- Files are encrypted at rest with [age](https://age-encryption.org/) — no custom cryptography
- The master key exists in memory only during active sessions
- Multi-key support: add backup keys, revoke compromised ones without re-encrypting
- All operations are recorded in an audit log (no content is ever logged)
- Path traversal and injection attacks are blocked at the boundary

See [spec/security.md](spec/security.md) for the full security model.

## Requirements

- Node.js 18+
- macOS, Linux, or Windows

## License

MIT
