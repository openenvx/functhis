// Functhis Function — edit input bindings and review required tools before replay.
// Source run: benchmark-replay
// Created: 2026-08-27T12:22:03.634Z
// This file is data for the Functhis runner; it is not executed as code.

export default 
{
  "apiVersion": "functhis.dev/v2",
  "description": "Benchmark replay for dashboard-html-alert",
  "inputs": {},
  "name": "dashboard-html-alert",
  "plan": {
    "output": "$step.fetch",
    "steps": [
      {
        "args": {},
        "id": "fetch",
        "select": "alerts[?alert==`PAYMENT_GATEWAY_DOWN` && severity==`critical`] | [0]",
        "tool": "fnbench.get_status_page"
      }
    ],
    "version": 1
  },
  "policy": {
    "allowNetwork": "upstream-only",
    "allowedTools": [
      "fnbench.get_status_page"
    ],
    "maxBytesPerResult": 262144,
    "maxCalls": 1,
    "writes": "deny"
  },
  "provenance": {
    "createdAt": "2026-08-27T12:22:03.634Z",
    "sourceRunId": "benchmark-replay"
  },
  "requiredTools": [
    "fnbench.get_status_page"
  ],
  "runtime": {
    "maxConcurrency": 1,
    "maxDurationMs": 900000,
    "maxOutputBytes": 262144,
    "maxTotalOutputBytes": 2097152
  },
  "sourcePath": "functions/dashboard-html-alert.ts",
  "toolFingerprints": {
    "fnbench.get_status_page": "732f36c4dca71f54"
  }
};
