# Quickstart Guide

Get your vault running in under 5 minutes.

## 1. Install

```bash
npm install -g workspace-vault
```

Verify it's installed:

```bash
vault --version
```

## 2. Initialize your vault

```bash
vault init
```

You'll be prompted to set a passphrase. This is your primary key — it encrypts the vault's master key. Choose something strong.

By default the vault is created at `~/.vault`. To use a different location:

```bash
vault init ~/my-vault
```

## 3. Store some files

```bash
# From a local file
vault write contracts/nda.pdf --from ~/Documents/nda.pdf

# With tags for easier searching
vault write medical/lab-results.pdf --from ~/Downloads/labs.pdf --tag medical --tag 2025

# From stdin
echo "API_KEY=sk-secret-12345" | vault write secrets/openai.txt
```

## 4. Verify your files are stored

```bash
vault list
```

This works even when the vault is locked — it shows filenames, sizes, dates, and tags, but never file content.

## 5. Read a file back

The vault starts locked after init. Unlock it first:

```bash
vault unlock
```

Then read:

```bash
vault read contracts/nda.pdf
```

## 6. Connect your AI agent

Add the MCP server to your agent's config.

### VS Code / GitHub Copilot

Create or edit `.vscode/mcp.json` in your workspace:

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

### Claude Desktop

Edit `claude_desktop_config.json` (find it via Claude Desktop → Settings → Developer):

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

### Cursor

Add to your MCP config in Cursor settings:

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

## 7. Use it

1. Run `vault unlock` in your terminal
2. Ask your agent to read or search your vault files
3. The vault auto-locks after 30 minutes, or run `vault lock` manually

### Example agent interactions

> "Search my vault for the NDA with Acme Corp"
>
> "Read the lab results from last month"
>
> "Save this contract draft to my vault as contracts/acme-draft.md"

## 8. Add a backup key

Don't rely on a single passphrase. Add a backup:

```bash
vault key add
```

You'll be prompted for a new passphrase and a label (e.g., "backup", "recovery"). Either key can unlock the vault independently.

## Next steps

- **[CLI Reference](cli.md)** — all commands and options
- **[MCP Tools Reference](mcp.md)** — what tools your agent sees
- **[Security Model](../spec/security.md)** — how encryption and access control work
