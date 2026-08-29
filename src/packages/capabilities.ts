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
  const lifecycle = manifest.lifecycle ?? 'active';
  if (lifecycle !== 'active') {
    return false;
  }
  if (manifest.capabilities.writes === 'deny') {
    return true;
  }
  return manifest.autonomousOrigin === true;
}

export function resolvesWriteApproval(
  manifest: PackageManifest,
  approveWrites?: boolean
): boolean {
  if (manifest.capabilities.writes !== 'review-required') {
    return Boolean(approveWrites);
  }
  if (approveWrites) {
    return true;
  }
  return manifest.autonomousOrigin === true;
}
