import type { UpstreamManager } from '../upstream/manager';
import type { PackageManifest } from './schema';

export function classifyPackageWrites(
  manager: UpstreamManager,
  allowedTools: string[]
): PackageManifest['capabilities']['writes'] {
  for (const toolId of allowedTools) {
    const tool = manager.catalog.getTool(toolId);
    if (tool?.risk === 'write' || tool?.risk === 'unknown') {
      return 'review-required';
    }
  }
  return 'deny';
}

export function hasWriteCapabilities(
  manager: UpstreamManager,
  allowedTools: string[]
): boolean {
  return classifyPackageWrites(manager, allowedTools) === 'review-required';
}

export function canHotRegister(manifest: PackageManifest): boolean {
  return manifest.capabilities.writes === 'deny';
}
