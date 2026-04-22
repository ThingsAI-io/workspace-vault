# Workspace Vault — Product Intent

## Problem

**AI agents need access to private files to be useful, but today there's no way to grant that access without giving up encryption at rest.**

In agentic workflows, the boundary between "what the agent can see" and "what's private" is a gentleman's agreement: `.gitignore` rules, `private/` folder conventions, trust. This works until it doesn't — a misconfigured tool, a leaked repo, a compromised extension.

The result is an all-or-nothing choice: either the agent reads everything (including sensitive documents), or it can't help at all. There's no middle ground where a user can keep private files encrypted at rest and still let the agent work with them — on the user's terms, not the agent's.

## Vision

An encrypted local vault with a **CLI** and **MCP server** that lets users store private files — emails, contracts, financial documents, medical records — encrypted at rest, with a user-controlled unlock gate that gives AI agents access only when explicitly authorized.

The user unlocks. The agent works. When the session ends, everything locks again.

**MVP promise in one sentence:** a single encrypted vault with user-controlled unlock that lets your AI agent read, search, and edit private files — without those files ever being stored in plaintext.

## Who Is This For

### Primary: The agentic workspace power user

Someone who runs AI agents on a local machine against a personal or professional knowledge base daily. They generate private artifacts — email drafts, legal correspondence, financial records — and want their agent to read and search them without sacrificing encryption at rest. They have a structured agentic workspace and are comfortable with a CLI.

- **Environment:** local desktop (macOS, Linux, Windows). Agent runs locally or connects to a local MCP server.
- **Biggest fear:** a leaked repo or misconfigured tool exposing their private documents.
- **Will not compromise on:** encryption at rest and knowing exactly what the agent accessed.
- **Will tolerate:** a CLI-based unlock step before each agent session.

**Jobs to be done:**
- Store sensitive documents where my agent can access them, but no one else can
- Let my agent search and reference private files during a conversation
- Revoke a compromised key without losing access to my files

### Secondary: The privacy-conscious developer

A developer building agentic workflows who needs encrypted artifact storage as part of a larger system. They want a tool they can trust not to leak secrets, with an API that feels like normal file operations.

- **Environment:** local development machine. May integrate the vault into a larger toolchain.
- **Biggest fear:** a dependency or tool silently logging sensitive content.
- **Will not compromise on:** auditability and clean API boundaries.

**Jobs to be done:**
- Integrate encrypted file access into my agent's tool chain
- Audit what my agent accessed and when
- Set up key recovery so a hardware failure doesn't mean data loss

### Non-user

Teams or organizations looking for shared encrypted storage. This is a single-user tool — collaboration and shared vaults are out of scope.

## Principles

1. **Locked by default, unlocked by intent** — the vault starts locked. The user explicitly unlocks it. The agent never self-authorizes.
2. **Zero crypto knowledge required** — the user experience is "store a file, read a file." Encryption is invisible. No key management jargon in the happy path.
3. **The agent works with files — the vault is invisible** — vault operations mirror standard file operations (`read`, `write`, `search`, `list`, `edit`). An agent that knows how to work with files already knows how to work with the vault.
4. **No silent failures** — if the vault is locked and the agent tries to read content, the error is clear and actionable ("vault is locked — run `vault unlock`"), not a cryptic empty response.
5. **Defense in depth, not trust** — secrets are encrypted at rest, paths are hidden, access is audited. Security is enforced by cryptography, not by hoping tools behave.

## How It Works

**CLI-first, MCP-second** — the CLI is the primary interface and the complete product. The MCP server is a thin wrapper that exposes the same operations as agent-callable tools. Everything the MCP server can do, the CLI can do first.

**Key design decisions:**

1. **Familiar file operations** — vault tools mirror what agents already use (`read_file`, `create_file`, `grep_search`, `list_dir`, `replace_string_in_file`, `file_search`). Zero learning curve for agents or users.

2. **Multi-key access** — the vault supports multiple authorized keys (passphrase, SSH key, backup key). Any one key can unlock the vault. Revoking a key is instant and doesn't require re-encrypting files.

3. **Unlock gate** — the MCP server starts locked. File content requires the user to explicitly unlock via CLI. The unlock is session-scoped — it expires when the session ends or after a configurable timeout.

4. **Metadata visibility** — while locked, the agent can browse file metadata (filenames, dates, tags) to understand what's in the vault. File content is inaccessible until unlock. Note: filenames themselves may reveal sensitive information — encrypted metadata is a future consideration (see Risks).

5. **Vault location is a secret** — the vault lives outside the workspace. Its path is stored in encrypted config, not in the repo.

6. **Built on `age` encryption** — no custom cryptography. Uses a well-audited encryption format that natively supports the multi-key access model.

**Admin vs. agent boundary:**

Not all operations are available to the agent. The CLI is the admin interface; the MCP server exposes only file operations.

| Operation | CLI | MCP (agent) |
|---|---|---|
| Init, configure vault | ✓ | ✗ |
| Unlock / lock | ✓ | ✗ |
| Add / revoke keys | ✓ | ✗ |
| Read, write, edit files | ✓ | ✓ (requires unlock) |
| Search file contents | ✓ | ✓ (requires unlock) |
| List files / browse metadata | ✓ | ✓ (available while locked) |
| View audit log | ✓ | ✗ |

## Scope

### MVP — What ships first

A user can:
- **Initialize** a vault with a passphrase or SSH key
- **Store** files into the vault (encrypted at rest)
- **Read** files from the vault (after unlocking)
- **Search** file contents and filenames within the vault
- **Edit** files in place within the vault
- **List** vault contents (metadata always visible; content requires unlock)
- **Unlock / lock** the vault explicitly via CLI
- **Add and revoke** authorized keys (multi-key access from day one)
- **View an audit log** of all vault operations

An AI agent can **read, write, search, edit, and list** vault files via MCP tools — gated by the unlock state. Admin operations (init, unlock, key management, audit) are CLI-only.

**Single vault, single user, local storage. Design center: local desktop agent workflows.**

### Future — What comes later

- **Multi-domain encryption** — independent vaults for different identity domains (professional, personal, medical, financial), each with their own master key and authorized key set. Unlock `professional` without exposing `medical`.
- **Cloud storage backends** — pluggable drivers for Azure Blob, OneDrive, S3, etc.
- **Hardware key integration** — first-class YubiKey / FIDO2 support for unlock.
- **Workspace integrations** — deeper integration with specific agentic frameworks.

## User Journeys

### First-time setup

Alex installs `workspace-vault` and runs `vault init`. The CLI asks for a passphrase and creates the vault in a local directory. Alex adds a backup SSH key with `vault key add`. The CLI prints an MCP config snippet; Alex pastes it into their agent's config. Done — two keys authorized, vault ready.

### Daily agent use

Alex is drafting a response to a legal inquiry. They run `vault unlock` in their terminal and provide their passphrase. The agent — already configured with the vault MCP tools — can now search for the original contract (`vault_grep_search`), read it, and reference specific clauses in its draft. After 30 minutes of inactivity, the vault auto-locks. The agent's next access attempt returns a clear "vault locked" message. Alex re-unlocks when needed.

### Key recovery

Alex's laptop is stolen. Their SSH key is compromised. From a new machine, they install `workspace-vault`, restore the vault directory from backup, and unlock using their passphrase (which the thief doesn't know). They revoke the compromised SSH key with `vault key revoke` and add a new one. No files were re-encrypted — the compromised key's wrapped copy of the master key was simply deleted.

## Security Principles

Security is a core product feature, not an afterthought. These principles govern every design and implementation decision:

1. **Encrypted at rest, always** — file content and key material are never stored in plaintext. The master key exists unwrapped only in memory during an active unlock session.
2. **Zero content leakage** — decrypted content, key material, and vault paths are never logged, telemetered, or sent to external endpoints. The vault is entirely local.
3. **Audit everything, log nothing sensitive** — every operation (read, write, search, unlock, lock) is recorded with timestamp and type. Content is never part of the audit trail.
4. **Never touch what isn't ours** — the vault never modifies external application configs (VS Code, Claude Desktop, etc.). It prints config snippets for the user to paste.
5. **Validate all input, trust nothing** — all paths, search patterns, and tool inputs are validated before use. Path traversal, injection, and escape attacks are blocked at the boundary.

> Detailed security requirements and anti-patterns from prior MCP tool audits are documented in [`spec/security.md`](security.md).

## Non-Goals

- **Not a password manager** — use 1Password or Bitwarden for credentials. The vault stores files, not secrets.
- **Not a backup system** — it stores files, doesn't version them. Use git or a backup tool for history.
- **Not a collaboration tool** — single-user, single-vault. No shared access, no team features.
- **Not full-disk encryption** — it protects specific files within a workflow, not the operating system.
- **Not a file versioning system** — the vault stores the current state of files. If you need version history, put the vault under git or use external versioning.
- **Not a multi-machine sync tool** — the vault is local. Syncing between machines (via cloud backends or otherwise) is a future consideration, not an MVP feature.
- **Not a multi-vault manager** — MVP supports one vault. Managing multiple independent vaults is a future consideration.

## Success Criteria

1. **Easy setup** — a user can initialize the vault and store their first file in under 5 minutes, with no cryptography knowledge. Measured via walkthrough testing.
2. **Seamless agent integration** — an AI agent configured with the MCP tools can read, search, and edit vault files with no changes to its prompts or workflow. The vault API feels identical to regular file operations.
3. **Unlock-gated access** — 100% of file-content access attempts while locked return a clear, actionable error ("vault is locked — run `vault unlock`"). The agent cannot bypass or self-authorize.
4. **Key resilience** — losing one authentication key does not cause data loss. Any remaining authorized key can unlock the vault and revoke the lost one. Verified by acceptance tests covering all key-loss scenarios.
5. **Encryption at rest** — private files are unreadable without an authorized key, even if the storage directory is fully compromised.
6. **Auditability** — 100% of read, write, search, unlock, and lock operations are recorded in the audit log with timestamp, operation type, and target path. No file content appears in the log.
7. **Cross-platform** — the CLI and MCP server pass acceptance tests on macOS, Ubuntu (latest LTS), and Windows 11.

## Risks & Open Questions

1. **Cross-platform file permissions** — POSIX systems support restrictive file permissions (`0700`/`0600`). Windows doesn't have a direct equivalent. How do we enforce comparable access control on Windows?
2. **Unlock UX in headless environments** — MVP targets local desktop workflows. Remote/headless agent environments (Codespaces, remote SSH) are a future consideration, but if demand arises early, we may need a browser-based or token-based unlock flow.
3. **Metadata exposure** — filenames and tags are readable without unlock (by design, for browsability). Filenames alone could leak sensitive information (e.g., "medical-diagnosis.pdf"). Should the user be able to opt into encrypted metadata in a future release?
4. **Adoption friction** — the vault requires explicit setup and changes to the agent's MCP config. Will users actually adopt it, or will the convenience of plaintext win?
5. **Age ecosystem maturity** — the `age` encryption format is well-audited but relatively young. Are there edge cases in the npm implementation (`age-encryption`) that could cause compatibility or reliability issues?
6. **Vault discovery vs. vault secrecy** — the vault path is a secret, but the MCP config references the `workspace-vault` binary. Could an attacker infer the vault's existence (if not its location) from the MCP config alone? Is that acceptable?
