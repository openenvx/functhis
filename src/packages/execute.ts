import type { CapabilityBroker } from '../sandbox/broker';
import type {
  SandboxExecuteOptions,
  SandboxExecuteResult,
} from '../sandbox/protocol';
import { executeSandboxCode } from '../sandbox/runner';
import type { PackageManifest } from './schema';

export async function executePackageCode(
  broker: CapabilityBroker,
  options: SandboxExecuteOptions,
  _execution: PackageManifest['runtime']['execution']
): Promise<SandboxExecuteResult> {
  return executeSandboxCode(broker, options);
}
