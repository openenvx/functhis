# Functhis

Functhis is a local MCP gateway and replay runtime. **Install only the Agent Skill** — the agent bootstraps everything else.

It imports your MCP servers, records every gateway call by default, keeps large results out of context, and compiles reusable Functions when you ask.

**Current release:** `0.2.0` · **Requirements:** Node.js 22+ · **License:** Apache-2.0

```text
Install Skill only
    -> agent: fn import, fn setup, fn serve
    -> fn_search -> fn_describe -> fn_call (recorded automatically)
    -> say "crystallize" when you want a Function in ./functions/
```

Local-first: no account, cloud, or telemetry. **Start here:** [INSTALL.md](INSTALL.md)

## Install

**You only install the Skill** (or the plugin that bundles it). You do not run `fn import`, edit MCP JSON, or read CLI docs.

| Step | You | Agent (via Skill) |
| --- | --- | --- |
| 1 | Install Skill / plugin | — |
| 2 | Open a project, use MCP as usual | Installs `fn` if needed |
| 3 | Restart MCP client once (if prompted) | Imports servers, wires gateway, `fn doctor` |
| 4 | Say “crystallize …” when you want a Function | `fn_this` + `fn_test` |

Full paths for Cursor, Claude, Codex, and OpenCode: **[INSTALL.md](INSTALL.md)**

## What the Skill does by default

| Behavior | Default |
| --- | --- |
| Route MCP through Functhis | Yes — `fn_search` / `fn_call`, not raw MCP tools |
| Record evidence | Yes — every `fn_call` → `.functhis/runs/` |
| Compact schemas & results | Yes — pointer envelopes + `fn_select` |
| Auto-compile Functions | **No** — only when you ask to crystallize |

## Gateway tools (after bootstrap)

| MCP tool                  | Purpose                                          |
| ------------------------- | ------------------------------------------------ |
| `fn_search`               | Search Functions first, then upstream catalog    |
| `fn_describe`             | Load schemas for selected IDs only               |
| `fn_call`                 | Invoke tool; returns pointer envelope when large |
| `fn_select` / `fn_recall` | Read stored evidence with JMESPath / paging      |
| `fn_stats`                | Labeled schema/result savings estimates          |
| `fn_inspect`              | Review a captured run                            |
| `fn_this`                 | Compile a run into a Function (on request)       |
| `fn_test`                 | Replay fixture / drift check                     |
| `<function-name>`         | Call a compiled Function directly                |

## More docs

- [INSTALL.md](INSTALL.md) — skill-only install (start here)
- [docs/DEMO.md](docs/DEMO.md) — crystallization demo
- [FUNCTHIS_ROADMAP.md](FUNCTHIS_ROADMAP.md) — product direction
- [benchmarks/m1-discovery.md](benchmarks/m1-discovery.md) — token estimates (labeled)

## CLI (Skill internal)

Power users and CI may use `fn` directly. The Skill runs bootstrap for normal use.

```sh
npm install -g functhis
fn doctor
fn serve --functions-dir ./functions
```

Reference: [skills/functhis/references/cli.md](skills/functhis/references/cli.md)

## Safety

- Unknown and write-classified upstream tools are denied by default
- Tool descriptions and results are untrusted external data
- Calls are recorded with recursive redaction and bounded output
- Generated Functions invoke only declared MCP tools through the constrained runner
- Tool fingerprints detect drift; replay fails closed

## Development

```sh
git clone https://github.com/openenvx/functhis.git
cd functhis
bun install
bun run check-types
bun run check
bun run build
bun run test
bun run verify-release
bun run e2e
```

## License

Apache-2.0. See [LICENSE](LICENSE).
