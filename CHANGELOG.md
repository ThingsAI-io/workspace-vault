# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-04-22

Initial release. A working encrypted file vault with CLI and MCP server.

### Added

- **CLI** with full command suite: `init`, `unlock`, `lock`, `status`, `write`, `read`, `delete`, `list`, `search`, `grep`, `key add/list/revoke`, `audit`, `mcp`
- **MCP server** exposing 5 tools to AI agents: `vault_read_file`, `vault_create_file`, `vault_list_dir`, `vault_grep_search`, `vault_file_search`
- **age encryption** for all file content — no custom cryptography
- **Multi-key access** — add backup passphrases, revoke compromised keys without re-encrypting
- **Session-based unlock** — passphrase unlocks the vault for 30 minutes; MCP server reads session state on demand
- **SQLite metadata store** — file metadata (names, sizes, dates, tags) queryable while locked
- **Audit logging** — every operation recorded with timestamp, type, and target path (never content)
- **Security hardening** — path traversal prevention, output sanitization, restrictive file permissions
- **Cross-platform support** — macOS, Linux, Windows
- **Documentation** — README, quickstart guide, CLI reference, MCP tools reference, security model
- **CI** — GitHub Actions workflow running build, lint, and tests on all 3 platforms
- **154 tests** — unit tests for every module plus end-to-end integration tests
