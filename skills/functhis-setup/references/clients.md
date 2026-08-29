# Client MCP configuration

Functhis exposes a stdio MCP server via `fn serve`. The **Skill** writes these entries automatically with `fn setup --write-client`.

**User install (Skill only):** [INSTALL.md](https://github.com/openenvx/functhis/blob/main/INSTALL.md)

## Auto-import sources

`fn import` reads stdio servers from:

| Client | Config paths |
| --- | --- |
| Cursor | `~/.cursor/mcp.json`, `.cursor/mcp.json` |
| Claude Code | `~/.claude/mcp.json`, `.mcp.json` |
| OpenCode | `~/.config/opencode/opencode.json(c)`, `opencode.json(c)`, `.opencode/opencode.json(c)` |

HTTP/remote servers and the Functhis gateway entry itself are skipped. Import and `fn doctor` print a warning when HTTP/SSE servers remain in the client.

## Write Functhis into a client (Skill bootstrap)

```bash
fn setup --write-client cursor --packages-dir ./packages
fn setup --write-client claude --packages-dir ./packages
fn setup --write-client opencode --packages-dir ./packages
```

Each command backs up the target config before merging.

## Manual snippets

**Cursor / Claude (`mcpServers`)**

```json
{
  "mcpServers": {
    "functhis": {
      "command": "fn",
      "args": ["serve", "--packages-dir", "./packages"]
    }
  }
}
```

**OpenCode (`mcp`)**

```json
{
  "mcp": {
    "functhis": {
      "type": "local",
      "command": ["fn", "serve", "--packages-dir", "./packages"],
      "enabled": true
    }
  }
}
```

Restart the MCP client after first setup or after compiling new Functions.

## Plugin marketplace install

**Claude Code**

```bash
claude plugin marketplace add openenvx/functhis
claude plugin install functhis@functhis
```

**Codex**

```bash
codex plugin marketplace add openenvx/functhis
codex plugin add functhis@functhis
```

**Cursor**

1. Settings → Plugins.
2. Add marketplace from GitHub: `https://github.com/openenvx/functhis`.
3. Install the `functhis` plugin.
