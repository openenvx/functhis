import { existsSync } from 'node:fs';
import { copyFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

export function backupFilePath(targetPath: string, timestamp?: string): string {
  const stamp =
    timestamp ??
    new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
  return `${targetPath}.bak-${stamp}`;
}

export async function backupFileIfExists(
  targetPath: string
): Promise<string | undefined> {
  if (!existsSync(targetPath)) {
    return undefined;
  }
  const backupPath = backupFilePath(targetPath);
  await copyFile(targetPath, backupPath);
  return backupPath;
}

export async function countBackupsForFile(targetPath: string): Promise<number> {
  const dir = join(targetPath, '..');
  const baseName = targetPath.split('/').pop() ?? targetPath;
  const prefix = `${baseName}.bak-`;
  const entries = await readdir(dir);
  return entries.filter((entry) => entry.startsWith(prefix)).length;
}
