// Functhis Function — edit input bindings and review required tools before replay.
// Source run: benchmark-replay
// Created: 2026-08-27T12:22:03.633Z
// This file is data for the Functhis runner; it is not executed as code.

export default 
{
  "apiVersion": "functhis.dev/v2",
  "description": "Benchmark replay for sre-log-needle",
  "inputs": {},
  "name": "sre-log-needle",
  "plan": {
    "output": "$step.fetch",
    "steps": [
      {
        "args": {},
        "id": "fetch",
        "select": "entries[?level==`FATAL` && service==`payments-api` && requestId==`req-fn-9f3c`] | [0] | {level: level, service: service, requestId: requestId}",
        "tool": "fnbench.get_sre_log"
      }
    ],
    "version": 1
  },
  "policy": {
    "allowNetwork": "upstream-only",
    "allowedTools": [
      "fnbench.get_sre_log"
    ],
    "maxBytesPerResult": 262144,
    "maxCalls": 1,
    "writes": "deny"
  },
  "provenance": {
    "createdAt": "2026-08-27T12:22:03.633Z",
    "sourceRunId": "benchmark-replay"
  },
  "requiredTools": [
    "fnbench.get_sre_log"
  ],
  "runtime": {
    "maxConcurrency": 1,
    "maxDurationMs": 900000,
    "maxOutputBytes": 262144,
    "maxTotalOutputBytes": 2097152
  },
  "sourcePath": "functions/sre-log-needle.ts",
  "toolFingerprints": {
    "fnbench.get_sre_log": "5932cdb29354d761"
  }
};
