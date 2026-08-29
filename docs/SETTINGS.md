# Settings

Functhis reads `.functhis/settings.json` (or `~/.functhis/settings.json` when you pass `--dir`). Missing file → defaults below. Unknown keys fail parse (Zod).

```json
{
  "version": 1,
  "learning": {
    "enabled": true,
    "minOccurrences": 2,
    "writePolicy": "scoped",
    "allowedWriteTools": [],
    "maxConcurrency": 2
  },
  "retention": {
    "maxAgeDays": 30,
    "maxRuns": 200
  }
}
```

## `learning`

| Field | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Autonomous compile → verify → promote loop |
| `minOccurrences` | `2` (min 2, max 20) | Same read-only tool sequence before crystallization |
| `writePolicy` | `"scoped"` | `"deny"` quarantines any write-classified flow. `"scoped"` promotes writes only when every write tool is listed in `allowedWriteTools` |
| `allowedWriteTools` | `[]` | Fully qualified ids (`serverId.toolName`) |
| `maxConcurrency` | `2` (1–8) | Parallel learning jobs |

Pause is an incident control (`fn_learning_pause` / `fn_learning_resume`), not a substitute for `enabled: false`.

State files (not settings):

| Path                              | Role                           |
| --------------------------------- | ------------------------------ |
| `.functhis/learning.json`         | Jobs and crystallized packages |
| `.functhis/learning-control.json` | Emergency pause flag           |
| `.functhis/events.jsonl`          | Durable observation log        |

## `retention`

Traces under `.functhis/runs/` are pruned. **Packages are never auto-deleted.**

| Field        | Default |
| ------------ | ------- |
| `maxAgeDays` | `30`    |
| `maxRuns`    | `200`   |

## Related

- Package layout: [PACKAGES.md](PACKAGES.md)
- Pointer envelopes: [MCP.md](MCP.md)
