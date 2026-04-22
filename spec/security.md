# Workspace Vault — Security Requirements

> This document contains detailed security requirements and anti-patterns referenced from the [product intent](intent.md). The intent document defines security *principles*; this document defines security *requirements* for implementation.

## Detailed Security Requirements

1. **Zero content logging** — never log decrypted file content, key material, or vault paths to stdout/stderr. Log only operation types and error classifications.
2. **No telemetry** — no analytics, no phone-home, no third-party endpoints. The vault is entirely local.
3. **No external config modification** — never write to VS Code, Claude Desktop, or any other application's config files. Print MCP config snippets for the user to paste.
4. **No debug tools in production** — no diagnostic, exploration, or key-dump tools exposed as MCP tools.
5. **Input validation** — all CLI args and MCP tool inputs validated via schemas before use. Reject unknown flags.
6. **Path traversal prevention** — validate all file paths to prevent escaping the vault directory (e.g., `../../etc/passwd`, symlink following). Resolve and verify every path stays within the vault root before any read/write.
7. **Terminal output sanitization** — strip ANSI escape sequences and control characters from decrypted content before terminal rendering to prevent escape injection attacks.
8. **Restrictive file permissions** — set owner-only permissions on vault config, key files, and the vault directory itself (POSIX: `0700` for dirs, `0600` for files). Windows equivalent TBD (see Risks in intent doc).
9. **Key material never on disk in plaintext** — the master key only exists unwrapped in memory during an active unlock session. Wrapped copies use `age` encryption. The unlock session is time-limited or process-scoped.
10. **Vault path is a secret** — stored only in encrypted config. The MCP server config references only the binary, not the vault location. The agent cannot discover where files live without an active unlock.
11. **No glob/regex injection** — validate search inputs to prevent pattern injection that could probe outside the vault boundary.
12. **Metadata vs. content separation** — metadata (filenames, dates, tags) is readable without unlock. Content requires explicit unlock. This boundary must be enforced, not advisory.
13. **Audit trail** — log every vault access (read, write, search, unlock, lock) with timestamp and operation type to a local audit file. Never log content — only operation metadata.

## Anti-Patterns (from prior MCP tool audits)

These mistakes were found in existing MCP tools and must not be repeated:

- **Plaintext secret storage** — tokens/keys stored in cleartext JSON files. If the file leaks, the attacker gets everything. → Encrypt all secrets at rest.
- **PII logging enabled** — user identifiers and content piped to stdout. → Never log PII or file content.
- **Auto-modifying external configs** — writing into other apps' config files without consent. → Never touch another app's files.
- **Debug tools in production** — diagnostic endpoints shipped in release builds. → No debug tools exposed.
- **Response content in logs** — truncated API/file content logged to stderr. → Log only status/error types, never content.
