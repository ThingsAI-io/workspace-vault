# Workspace Vault — MVP Implementation Plan

## Architecture Overview

```
src/
  crypto/       — age encryption: encrypt/decrypt buffers, key generation, master key wrap/unwrap
  vault/        — vault init, file CRUD (encrypt/decrypt on disk), metadata (SQLite)
  session/      — daemon/broker: holds master key in memory, local socket IPC
  audit/        — append-only audit log (SQLite table)
  security/     — path validation, input sanitization (Zod), output sanitization, file permissions
  config/       — vault config (~/.config/workspace-vault/config.json), vault path pointer
  cli/          — CLI commands (commander.js)
  mcp/          — MCP server (thin wrapper, talks to daemon)
  types.ts      — shared types and error definitions
  index.ts      — public API
test/
  unit/         — unit tests per module
  integration/  — end-to-end CLI + MCP workflows
```

## Key Design Decisions

### Unlock model: Daemon/broker
- `vault unlock` prompts for passphrase, unwraps master key, starts a background daemon on a local socket (Unix) or named pipe (Windows)
- The daemon holds the master key in memory — it never leaves this process
- CLI commands and MCP server connect to the daemon for operations requiring the master key
- `vault lock` tells the daemon to drop the key and shut down
- Timeout: daemon auto-locks after configurable period (default 30 min)
- CLI commands that only need metadata (list, status) work without the daemon

### Metadata: SQLite (via better-sqlite3)
- Single SQLite database in the vault directory
- Tables: files (metadata), keys (authorized key records)
- Audit log: separate SQLite table (append-only by convention)
- Daemon is the primary writer; CLI reads metadata directly for lock-safe operations

### Encrypted file storage
- Each file stored as `<vault>/files/<uuid>.age` (age-encrypted blob)
- Metadata in SQLite maps original path → UUID → encryption metadata
- Master key generated on `vault init`, wrapped for each authorized key

### Auth: Passphrase only (MVP)
- SSH key support deferred to post-MVP
- Passphrase → age identity via scrypt-based key derivation

### Config: Plain JSON
- `~/.config/workspace-vault/config.json` — stores vault path, daemon socket path
- Not encrypted for MVP (vault path is not treated as a high-value secret in MVP)
- Restrictive file permissions (POSIX 0600)

## MVP Scope (what we build)

### CLI Commands
- `vault init` — create vault, set passphrase, print MCP config snippet
- `vault unlock` — prompt passphrase, start daemon, hold master key
- `vault lock` — tell daemon to drop key, shut down
- `vault status` — locked/unlocked, file count, key count
- `vault write <vault-path> [--from <local-file>]` — encrypt and store (stdin or file)
- `vault read <vault-path>` — decrypt and print to stdout
- `vault delete <vault-path>` — remove encrypted file + metadata
- `vault list [vault-path]` — list metadata (works while locked)
- `vault search <query>` — search filenames/tags (works while locked)
- `vault grep <pattern>` — grep decrypted content (requires unlock)
- `vault key add` — add passphrase-based key
- `vault key list` — list authorized keys
- `vault key revoke <key-id>` — delete wrapped master key copy
- `vault audit [--tail N]` — show audit log

### MCP Tools (agent-facing)
- `vault_read_file` — read decrypted content (requires unlock)
- `vault_create_file` — create encrypted file (requires unlock)
- `vault_list_dir` — list file metadata (works while locked)
- `vault_grep_search` — grep content (requires unlock)
- `vault_file_search` — search filenames (works while locked)

### What's cut from MVP
- `vault edit` — plaintext temp file risk; deferred
- SSH key auth — passphrase only for now
- Encrypted config — plain JSON with restrictive permissions
- `vault_replace_string_in_file` — requires edit capability; deferred
- True cryptographic revocation — MVP revoke prevents future unlocks only

## Implementation Phases

### Phase 1: Project Scaffold
- package.json, tsconfig.json, ESLint, Vitest, Prettier
- Directory structure with barrel exports
- CI: GitHub Actions for build + test + lint

### Phase 2: Foundation (parallelizable)
- **crypto**: age encrypt/decrypt, passphrase-to-identity, master key generation, wrap/unwrap
- **security**: path validation, Zod schemas, output sanitization, file permissions
- **types**: error types, operation types, shared interfaces

### Phase 3: Core Engine (depends on Phase 2)
- **config**: config CRUD, vault path management, first-run detection
- **vault**: init (create structure + master key + wrap), metadata SQLite, file write/read/delete/list
- **audit**: SQLite audit log, event recording

### Phase 4: Session Layer (depends on Phase 2)
- **session/daemon**: local socket/named pipe server, master key holder, timeout, lock/unlock protocol
- **session/client**: client library for CLI + MCP to talk to daemon

### Phase 5: Interfaces (depends on Phase 3 + 4, parallelizable)
- **CLI**: all commands using commander.js, interactive passphrase prompt
- **MCP**: server setup with @modelcontextprotocol/sdk, tool definitions, locked-state errors

### Phase 6: Integration Tests (depends on Phase 5)
- End-to-end CLI workflows
- MCP server locked/unlocked behavior
- Key add/revoke scenarios
- Path traversal rejection tests
- Audit log completeness
- Cross-platform smoke tests
