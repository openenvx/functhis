export type FnbenchShape =
  | 'log'
  | 'json'
  | 'csv'
  | 'test-output'
  | 'yaml'
  | 'html';

export interface FnbenchCase {
  id: string;
  shape: FnbenchShape;
  toolName: string;
  upstreamId: string;
  oracle: Record<string, unknown>;
  /** JMESPath on tool JSON for replay Functions (fn_select / plan select). */
  replaySelect: string;
  prompt: string;
}

export const SRE_LOG_ORACLE = {
  level: 'FATAL',
  requestId: 'req-fn-9f3c',
  service: 'payments-api',
} as const;

export const DEPLOYMENT_DRIFT_ORACLE = {
  actual: '1.3.9',
  driftedService: 'worker-billing',
  expected: '1.4.2',
} as const;

export const FRAUD_OUTLIER_ORACLE = {
  accountId: 'acct-88021',
  amount: 999_999.99,
} as const;

export const TEST_FAILURE_ORACLE = {
  failedTest: 'AuthToken.refresh/expired',
  file: 'auth.test.ts',
  line: 214,
} as const;

export const CONFIG_DRIFT_ORACLE = {
  actual: 12,
  expected: 3,
  key: 'replicas',
} as const;

export const HTML_ALERT_ORACLE = {
  alert: 'PAYMENT_GATEWAY_DOWN',
  severity: 'critical',
} as const;

export const FNBENCH_CASES: FnbenchCase[] = [
  {
    id: 'sre-log-needle',
    oracle: { ...SRE_LOG_ORACLE },
    prompt: [
      'Call the MCP tool `get_sre_log` exactly once (no arguments).',
      'Find the single FATAL log entry for service payments-api with requestId req-fn-9f3c.',
      'Reply with ONLY a JSON object: {"level":"FATAL","service":"payments-api","requestId":"req-fn-9f3c"}.',
      'No markdown, no explanation.',
    ].join(' '),
    replaySelect:
      'entries[?level==`FATAL` && service==`payments-api` && requestId==`req-fn-9f3c`] | [0] | {level: level, service: service, requestId: requestId}',
    shape: 'log',
    toolName: 'get_sre_log',
    upstreamId: 'fnbench.get_sre_log',
  },
  {
    id: 'deployment-json-drift',
    oracle: { ...DEPLOYMENT_DRIFT_ORACLE },
    prompt: [
      'Call the MCP tool `get_deployment_manifest` exactly once.',
      'Find service worker-billing: expected version 1.4.2 but actual 1.3.9.',
      'Reply with ONLY: {"driftedService":"worker-billing","expected":"1.4.2","actual":"1.3.9"}.',
    ].join(' '),
    replaySelect:
      'services[?name==`worker-billing`] | [0] | {driftedService: name, expected: expectedVersion, actual: version}',
    shape: 'json',
    toolName: 'get_deployment_manifest',
    upstreamId: 'fnbench.get_deployment_manifest',
  },
  {
    id: 'fraud-csv-outlier',
    oracle: { ...FRAUD_OUTLIER_ORACLE },
    prompt: [
      'Call the MCP tool `get_fraud_ledger` exactly once.',
      'Find the outlier row with accountId acct-88021 and amount 999999.99.',
      'Reply with ONLY: {"accountId":"acct-88021","amount":999999.99}.',
    ].join(' '),
    replaySelect:
      'rows[?accountId==`acct-88021` && amount==`999999.99`] | [0] | {accountId: accountId, amount: amount}',
    shape: 'csv',
    toolName: 'get_fraud_ledger',
    upstreamId: 'fnbench.get_fraud_ledger',
  },
  {
    id: 'test-output-failure',
    oracle: { ...TEST_FAILURE_ORACLE },
    prompt: [
      'Call the MCP tool `get_ci_log` exactly once.',
      'Find the failed test AuthToken.refresh/expired in auth.test.ts line 214.',
      'Reply with ONLY: {"failedTest":"AuthToken.refresh/expired","file":"auth.test.ts","line":214}.',
    ].join(' '),
    replaySelect:
      'failures[?name==`AuthToken.refresh/expired`] | [0] | {failedTest: name, file: file, line: line}',
    shape: 'test-output',
    toolName: 'get_ci_log',
    upstreamId: 'fnbench.get_ci_log',
  },
  {
    id: 'config-yaml-drift',
    oracle: { ...CONFIG_DRIFT_ORACLE },
    prompt: [
      'Call the MCP tool `get_cluster_config` exactly once.',
      'Find replicas drift: expected 3, actual 12.',
      'Reply with ONLY: {"key":"replicas","expected":3,"actual":12}.',
    ].join(' '),
    replaySelect:
      'settings | {key: `replicas`, expected: replicas_expected, actual: replicas}',
    shape: 'yaml',
    toolName: 'get_cluster_config',
    upstreamId: 'fnbench.get_cluster_config',
  },
  {
    id: 'dashboard-html-alert',
    oracle: { ...HTML_ALERT_ORACLE },
    prompt: [
      'Call the MCP tool `get_status_page` exactly once.',
      'Find the critical alert PAYMENT_GATEWAY_DOWN.',
      'Reply with ONLY: {"alert":"PAYMENT_GATEWAY_DOWN","severity":"critical"}.',
    ].join(' '),
    replaySelect:
      'alerts[?alert==`PAYMENT_GATEWAY_DOWN` && severity==`critical`] | [0]',
    shape: 'html',
    toolName: 'get_status_page',
    upstreamId: 'fnbench.get_status_page',
  },
];
