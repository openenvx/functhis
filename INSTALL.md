# Install Functhis

You only install the **Skill** (or plugin). The agent installs the CLI, imports stdio MCP servers, wires the gateway, and turns on **autonomous learning** (repeated read-only flows become `packages/auto-*` without a prompt).

**Requirements:** Node.js 22 or newer. No Functhis account, cloud, or API key.

The CLI is the npm package `functhis` (`fn` / `functhis` binaries). If `npm install -g functhis` 404s, the agent falls back to `npm install -g github:openenvx/functhis`.

## 1. Install the Skill

You do **not** need to run `fn import`, edit `mcp.json`, or read CLI docs.

### Cursor (recommended)

**Option A — Plugin (includes Skills)**

1. Open **Cursor Settings → Plugins**.
2. Add a marketplace from GitHub: `https://github.com/openenvx/functhis` (this repo’s `.cursor-plugin/marketplace.json`).
3. Install the **functhis** plugin.
4. Open a project where you use MCP tools.

**Option B — Skill only**

1. Copy [`skills/functhis/SKILL.md`](skills/functhis/SKILL.md) into your Cursor skills directory, **or** symlink this repo’s `skills/functhis/` folder.
2. Open a project where you use MCP tools.

### Claude Code

```bash
claude plugin marketplace add openenvx/functhis
claude plugin install functhis@functhis
```

Or copy [`skills/functhis/SKILL.md`](skills/functhis/SKILL.md) into your Claude skills path.

### Codex

```bash
codex plugin marketplace add openenvx/functhis
codex plugin add functhis@functhis
```

### OpenCode

Copy [`skills/functhis/SKILL.md`](skills/functhis/SKILL.md) and follow [skills/functhis-setup/references/clients.md](skills/functhis-setup/references/clients.md) only if auto-bootstrap fails.

---

## 2. Use it (first session)

Open a project and ask the agent to use MCP as usual — for example:

> Look up GitHub issues for this repo.

Or explicitly:

> Bootstrap Functhis for this project and use it for all MCP calls.

**The Skill will automatically:**

1. Install `functhis` globally if `fn` is missing (`npm install -g functhis`, or GitHub if npm 404s)
2. Import your existing **stdio** MCP servers from Cursor / Claude / OpenCode into `.functhis/upstreams.json` (HTTP/SSE servers are skipped and reported)
3. Add the Functhis gateway to your client MCP config (`fn setup --write-client …`)
4. Run `fn doctor`
5. Route MCP work through `fn_search` → `fn_describe` → `fn_call`

**You do one manual step once:** restart the MCP client if `fn_search` is not in the tool list yet (Cursor: reload window or restart MCP servers).

After that, **recording is automatic**. Every `fn_call` writes evidence to `.functhis/runs/` with compact pointer responses. See [docs/MCP.md](docs/MCP.md).

**Learning is automatic.** When the same read-only gateway flow repeats (default: twice), Functhis compiles, verifies, and promotes `packages/auto-*`. You do not approve the save. Use `fn_save_function` only for a custom name or a write-capable override.

---

## 3. What you get without doing anything else

| Behavior | Default |
| --- | --- |
| MCP schema tokens | Compact meta-tools instead of full catalog |
| Large tool results | Pointer envelope + `fn_select` ([contract](docs/MCP.md)) |
| Evidence / traces | Recorded on every `fn_call` |
| Repeated read-only flows | Auto-saved as `packages/auto-*` |
| Write-capable flows | Quarantined unless listed in `learning.allowedWriteTools` ([settings](docs/SETTINGS.md)) |

The agent should **not** call other MCP servers directly when Functhis is available — bypasses cannot be recorded or learned.

---

## 4. Named packages (optional)

Autonomous names look like `auto-get-user-issues`. To pick a name:

> Save that workflow as a function package named `get-deploy-issues`.

The agent runs `fn_save_function` and writes:

```text
packages/<name>/
  function.ts
  functhis.json
  functhis.lock
```

See [docs/PACKAGES.md](docs/PACKAGES.md) and the [layout example](examples/get-user-issues).

---

## 5. Useful phrases

| You say | Agent does |
| --- | --- |
| “Use Functhis for this” | Bootstrap if needed, route MCP through gateway |
| “What did Functhis record?” | `fn_inspect` on the current `runId` |
| “Pull field X from the last call” | `fn_select` with JMESPath |
| “How much context did we save?” | `fn_stats` (local estimates) |
| “Save this workflow as a function” | Named `fn_save_function` (overrides auto-*) |

---

## 6. What gets committed

| Path                       | Purpose                                      |
| -------------------------- | -------------------------------------------- |
| `packages/<name>/`         | Saved packages (commit these)                |
| `.functhis/upstreams.json` | Imported MCP server config (optional commit) |
| `.functhis/runs/`          | Local traces (usually **gitignore**)         |

```gitignore
.functhis/runs/
```

---

## 7. FAQ

**Why restart the MCP client?** The client spawned `fn serve` before Functhis was on PATH or before the gateway entry existed. One restart loads `fn_search`.

**Why Node 22?** The sandbox uses Node’s permission model. Older Node will not run packages safely.

**Where is data?** Project `.functhis/` (or `--dir`). Runs, settings, learning state, and the SQLite graph live there. Packages live in `./packages/`.

**HTTP / SSE MCP servers?** Import skips them (stdio only). `fn import` and `fn doctor` print a warning. Keep the remote server in the client if you still need it; Functhis will not observe those calls.

**Repo graph empty?** Indexing needs `tsconfig.json` (TypeScript only). Gateway and packages still work.

**`npm install -g functhis` 404?** The registry package is not published yet. Use `npm install -g github:openenvx/functhis` (npm runs `tsc` via `prepack`).

**Uninstall?** Remove the Skill/plugin, delete the `functhis` entry from client MCP config (a backup may sit next to the file), optional `npm uninstall -g functhis`, optional delete `.functhis/`. Original upstream MCP entries are unchanged.

---

## 8. Troubleshooting

| Problem | What to do |
| --- | --- |
| No `fn_search` in tools | Restart MCP client once after first bootstrap |
| Agent still calls GitHub MCP directly | “Route all MCP through Functhis.” Skill must be active. |
| `fn import` found zero servers | Configure **stdio** MCP servers in the client, then bootstrap again |
| HTTP servers skipped | Expected — see FAQ. Doctor lists them as warnings, not failures. |
| Write tools quarantined | `learning.writePolicy: "scoped"` and `learning.allowedWriteTools` in `.functhis/settings.json` |
| Learning paused unexpectedly | `fn_learning_resume` or delete `.functhis/learning-control.json` |
| Save failed | Valid package name and allowlisted tools |

Power users / CI: [skills/functhis/references/cli.md](skills/functhis/references/cli.md), [docs/DEMO.md](docs/DEMO.md).

---

## 9. Uninstall

1. Remove the Skill or plugin from your agent.
2. Remove the `functhis` entry from `~/.cursor/mcp.json` or project `.cursor/mcp.json` (a backup may exist next to the file).
3. Optional: `npm uninstall -g functhis`
4. Optional: delete `.functhis/` in projects where you used it.

Your original MCP server entries in client config are unchanged; Functhis only merged in its gateway entry.
