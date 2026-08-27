# M1 discovery benchmark

Token counts are **estimates** using gpt-tokenizer on serialized JSON schemas.

| Arm                             | Schema tokens (est.) |
| ------------------------------- | -------------------: |
| Direct MCP (all tools)          |                 6504 |
| Functhis discovery (meta-tools) |                  124 |
| Saved Function replay           |             n/a (M3) |

Schema reduction: 98.1%

## Result shaping (local fixture, est.)

| Metric                          | Value |
| ------------------------------- | ----: |
| Stored result bytes             | 67805 |
| Returned envelope bytes         |   267 |
| Stored result tokens (est.)     | 16952 |
| Returned envelope tokens (est.) |    67 |
| Result byte reduction           | 99.6% |

## Latency (local fixture, ms)

| Step                | Median-ish (single run) |
| ------------------- | ----------------------: |
| fn_search           |                     0.9 |
| fn_describe (3 ids) |                     0.0 |
| fn_call             |                     3.4 |
