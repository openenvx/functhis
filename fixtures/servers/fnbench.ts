import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';

import {
  CONFIG_DRIFT_ORACLE,
  DEPLOYMENT_DRIFT_ORACLE,
  FRAUD_OUTLIER_ORACLE,
  HTML_ALERT_ORACLE,
  SRE_LOG_ORACLE,
  TEST_FAILURE_ORACLE,
} from '../benchmark/cases';
import { noiseLine, padPayload } from '../benchmark/payload';

function toolText(payload: unknown) {
  return {
    content: [
      {
        text: JSON.stringify(payload),
        type: 'text' as const,
      },
    ],
  };
}

function buildSreLogPayload(fillerCount: number) {
  const entries = Array.from({ length: fillerCount }, (_, index) => ({
    level: 'INFO',
    message: noiseLine(index, 'health-check'),
    requestId: `req-info-${index}`,
    service: `svc-${index % 40}`,
    timestamp: `2026-08-27T10:${String(index % 60).padStart(2, '0')}:00Z`,
  }));
  entries.splice(Math.floor(fillerCount / 2), 0, {
    level: SRE_LOG_ORACLE.level,
    message: 'checkout authorization failed',
    requestId: SRE_LOG_ORACLE.requestId,
    service: SRE_LOG_ORACLE.service,
    timestamp: '2026-08-27T10:30:00Z',
  });
  return { entries, kind: 'sre-log' };
}

function buildDeploymentPayload(fillerCount: number) {
  const services = Array.from({ length: fillerCount }, (_, index) => ({
    expectedVersion: `1.${index % 9}.0`,
    name: `worker-${index}`,
    version: `1.${index % 9}.0`,
  }));
  services.splice(42, 0, {
    expectedVersion: DEPLOYMENT_DRIFT_ORACLE.expected,
    name: DEPLOYMENT_DRIFT_ORACLE.driftedService,
    version: DEPLOYMENT_DRIFT_ORACLE.actual,
  });
  return { kind: 'deployment-manifest', services };
}

function buildFraudPayload(fillerCount: number) {
  const rows = Array.from({ length: fillerCount }, (_, index) => ({
    accountId: `acct-${10_000 + index}`,
    amount: Number((index % 500) + 0.01),
    currency: 'USD',
    region: `r-${index % 12}`,
  }));
  rows.splice(880, 0, {
    accountId: FRAUD_OUTLIER_ORACLE.accountId,
    amount: FRAUD_OUTLIER_ORACLE.amount,
    currency: 'USD',
    region: 'r-outlier',
  });
  return { kind: 'fraud-ledger', rows };
}

function buildCiLogPayload(fillerCount: number) {
  const passing = Array.from({ length: fillerCount }, (_, index) => ({
    durationMs: 12 + (index % 40),
    file: `suite-${index % 30}.test.ts`,
    name: `Suite${index}::passes`,
    status: 'passed',
  }));
  return {
    failures: [
      { ...TEST_FAILURE_ORACLE, name: TEST_FAILURE_ORACLE.failedTest },
    ],
    kind: 'ci-log',
    passing,
  };
}

function buildClusterConfigPayload(fillerCount: number) {
  const resources = Array.from({ length: fillerCount }, (_, index) => ({
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: { name: `deploy-${index}`, namespace: 'prod' },
    spec: { replicas: (index % 5) + 1 },
  }));
  return {
    kind: 'cluster-config',
    resources,
    settings: {
      replicas: CONFIG_DRIFT_ORACLE.actual,
      replicas_expected: CONFIG_DRIFT_ORACLE.expected,
    },
  };
}

function buildStatusPagePayload(fillerCount: number) {
  const panels = Array.from({ length: fillerCount }, (_, index) => ({
    id: `panel-${index}`,
    status: index % 17 === 0 ? 'degraded' : 'healthy',
    title: `Service metric ${index}`,
    value: (index * 1.7) % 100,
  }));
  return {
    alerts: [{ ...HTML_ALERT_ORACLE }],
    kind: 'status-page',
    panels,
  };
}

const sreLogPayload = padPayload(buildSreLogPayload);
const deploymentPayload = padPayload(buildDeploymentPayload);
const fraudPayload = padPayload(buildFraudPayload);
const ciLogPayload = padPayload(buildCiLogPayload);
const clusterConfigPayload = padPayload(buildClusterConfigPayload);
const statusPagePayload = padPayload(buildStatusPagePayload);

async function main(): Promise<void> {
  const server = new McpServer({
    name: 'functhis-fnbench',
    version: '0.1.0',
  });

  server.registerTool(
    'get_sre_log',
    {
      description:
        'Read-only SRE log dump for triage. Returns production log entries.',
      inputSchema: z.object({}),
    },
    async () => toolText(sreLogPayload)
  );

  server.registerTool(
    'get_deployment_manifest',
    {
      description:
        'Read-only deployment manifest lookup with service versions.',
      inputSchema: z.object({}),
    },
    async () => toolText(deploymentPayload)
  );

  server.registerTool(
    'get_fraud_ledger',
    {
      description: 'Read-only fraud ledger rows for analysis.',
      inputSchema: z.object({}),
    },
    async () => toolText(fraudPayload)
  );

  server.registerTool(
    'get_ci_log',
    {
      description: 'Read-only CI test output with pass and fail records.',
      inputSchema: z.object({}),
    },
    async () => toolText(ciLogPayload)
  );

  server.registerTool(
    'get_cluster_config',
    {
      description: 'Read-only cluster configuration resources and settings.',
      inputSchema: z.object({}),
    },
    async () => toolText(clusterConfigPayload)
  );

  server.registerTool(
    'get_status_page',
    {
      description: 'Read-only dashboard status panels and active alerts.',
      inputSchema: z.object({}),
    },
    async () => toolText(statusPagePayload)
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
