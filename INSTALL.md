# Install Functhis

You only install the **Skill**. The agent handles everything else — CLI install, MCP import, gateway wiring, recording, and (when you ask) saving packages.

**Requirements:** Node.js 22 or newer (the agent uses it to run `fn` locally). No account, cloud, or API key for Functhis itself.

## 1. Install the Skill

Pick your agent. You do **not** need to run `fn import`, edit `mcp.json`, or read CLI docs.

### Cursor (recommended)

**Option A — Plugin (includes Skills)**

1. In Cursor: Settings → Rules / Plugins → add marketplace from this repo (or the published marketplace URL when available).
2. Install the **functhis** plugin.
3. Open a project where you use MCP tools.

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

1. Install `functhis` globally if `fn` is missing (`npm install -g functhis`)
2. Import your existing stdio MCP servers from Cursor / Claude / OpenCode into `.functhis/upstreams.json`
3. Add the Functhis gateway to your client MCP config (`fn setup --write-client …`)
4. Run `fn doctor`
5. Route MCP work through `fn_search` → `fn_describe` → `fn_call`

**You do one manual step once:** restart the MCP client if `fn_search` is not in the tool list yet (Cursor: reload window or restart MCP servers).

After that, **recording is automatic**. Every `fn_call` writes evidence to `.functhis/runs/` with compact pointer responses so large results do not bloat context. See [docs/MCP.md](docs/MCP.md) for envelope fields and how to use `fn_select`.

---

## 3. What you get without doing anything else

| Behavior | Default |
| --- | --- |
| MCP schema tokens | Compact meta-tools instead of full catalog |
| Large tool results | Pointer envelope + `fn_select` for fields ([contract](docs/MCP.md)) |
| Evidence / traces | Recorded on every `fn_call` |
| Save a function package | **Only when you ask** (see below) |

The agent should **not** call other MCP servers directly when Functhis is available — all MCP traffic goes through the gateway so it can be recorded and shaped.

---

## 4. Save a package when you want a reusable function

When sandbox logic worked and you want it saved in the repo:

> Save that workflow as a function package named `get-deploy-issues`.

The agent will run `fn_save_function` and create:

```text
packages/<name>/
  function.ts
  functhis.json
  functhis.lock
```

You do not run terminal commands yourself. On similar tasks later, the agent prefers the saved package (one tool, no rediscovery).

---

## 5. Useful phrases

| You say | Agent does |
| --- | --- |
| “Use Functhis for this” | Bootstrap if needed, route MCP through gateway |
| “What did Functhis record?” | `fn_inspect` on the current `runId` |
| “Pull field X from the last call” | `fn_select` with JMESPath |
| “How much context did we save?” | `fn_stats` |
| “Save this workflow as a function” | `fn_execute_code` then `fn_save_function` |

---

## 6. What gets committed

| Path | Purpose |
| --- | --- |
| `packages/<name>/` | Saved packages (commit these) |
| `.functhis/upstreams.json` | Imported MCP server config (optional commit) |
| `.functhis/runs/` | Local traces (usually **gitignore** — evidence, not product code) |

Add to `.gitignore` if you do not want runs in git:

```gitignore
.functhis/runs/
```

---

## 7. Troubleshooting

| Problem | What to do |
| --- | --- |
| No `fn_search` in tools | Restart MCP client once after first bootstrap |
| Agent still calls GitHub MCP directly | Say: “Route all MCP through Functhis.” Ensure the Skill is active. |
| `fn import` found zero servers | Configure MCP servers in Cursor first, then ask agent to bootstrap again |
| Write tools denied | By design — start with read-only tools |
| Save failed | Ask agent to retry with a valid package name and allowlisted tools |

For power users and CI, see [skills/functhis/references/cli.md](skills/functhis/references/cli.md) and [docs/DEMO.md](docs/DEMO.md).

---

## 8. Uninstall

1. Remove the Skill or plugin from your agent.
2. Remove the `functhis` entry from `~/.cursor/mcp.json` or project `.cursor/mcp.json` (a backup may exist next to the file).
3. Optional: `npm uninstall -g functhis`
4. Optional: delete `.functhis/` in projects where you used it.

Your original MCP server entries in client config are unchanged; Functhis only merged in its gateway entry.
