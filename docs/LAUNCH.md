# Launch checklist

Use this after `functhis@0.2.0` is on npm and GitHub.

## Install paths

| Channel | Command / link |
| --- | --- |
| npm | `npm install -g functhis` |
| npx | `npx functhis --help` |
| GitHub | https://github.com/openenvx/functhis |
| Cursor plugin | Install from repo `.cursor-plugin/marketplace.json` or clone + marketplace add |
| Claude Code | `.claude-plugin/marketplace.json` |
| Codex | `.agents/plugins/marketplace.json` |
| Skills (in-repo) | `skills/functhis/SKILL.md`, `skills/functhis-setup/SKILL.md` |

## Five-minute demo script

Post this flow (video, blog, or issue template):

```sh
npm install -g functhis
git clone https://github.com/openenvx/functhis.git && cd functhis
fn setup --dir .functhis-demo
fn doctor --dir .functhis-demo
fn test lookup-user-issues --dir .functhis-demo --functions-dir ./functions --repeat 30
fn serve --dir .functhis-demo --functions-dir ./functions
```

Point MCP clients at the stdio server above. Install the Functhis Skill so agents know to search → call → inspect → `fn this`.

See [DEMO.md](./DEMO.md) for the full crystallization loop.

## Success metric (week 10)

Track toward **20 external installations** or document why not:

- npm download counts (`npm view functhis`)
- GitHub stars/forks and install-failure issues
- Developer interviews (target ~10)

Do **not** claim "70% cheaper tasks" in launch copy. Schema-token reduction on fixtures is documented as an **estimate** in the benchmark report.

## After launch

Hold new product features until [VALIDATION.md](./VALIDATION.md) gates pass. No Cloud, HTTP gateway, or arbitrary local code execution until then.
