import type { McpServer } from '@modelcontextprotocol/server';

import type { GraphService } from '../graph/service';
import type { GatewayDependencies } from '../mcp/package-tools';
import { reconcilePackageTools } from '../mcp/package-tools';
import type { PackageLibrary } from '../packages/library';
import { loadSettings } from '../storage/settings';
import type { ExecutionTrace } from '../trace/schema';
import type { UpstreamManager } from '../upstream/manager';
import { processAutonomousLearning } from './autonomous';
import { isLearningPaused } from './control';
import { recoverOrphanedLearningJobs } from './recovery';

export interface LearningWorkerDeps {
  configDir: string;
  graph?: GraphService;
  manager: UpstreamManager;
  onPackageSaved?: (name: string) => Promise<void>;
  packageLibrary: PackageLibrary;
  packagesDir: string;
  server?: McpServer;
}

export class LearningWorker {
  private activeJobs = 0;
  private queue: ExecutionTrace[] = [];
  private draining = false;
  private paused = false;

  constructor(private readonly deps: LearningWorkerDeps) {}

  enqueue(trace: ExecutionTrace): void {
    if (this.paused) {
      return;
    }
    this.queue.push(trace);
    void this.drain();
  }

  async pause(): Promise<void> {
    this.paused = true;
  }

  async resume(): Promise<void> {
    this.paused = false;
    void this.drain();
  }

  getQueueDepth(): number {
    return this.queue.length;
  }

  isProcessing(): boolean {
    return this.activeJobs > 0 || this.draining;
  }

  private async drain(): Promise<void> {
    if (this.draining || this.paused) {
      return;
    }
    if (await isLearningPaused(this.deps.configDir)) {
      this.paused = true;
      return;
    }

    this.draining = true;
    try {
      const settings = await loadSettings(this.deps.configDir);
      const maxConcurrency = settings.learning?.maxConcurrency ?? 2;

      while (this.queue.length > 0 && this.activeJobs < maxConcurrency) {
        const trace = this.queue.shift();
        if (!trace) {
          continue;
        }
        this.activeJobs += 1;
        void this.processTrace(trace).finally(() => {
          this.activeJobs -= 1;
          void this.drain();
        });
      }
    } finally {
      this.draining = false;
    }
  }

  private async processTrace(trace: ExecutionTrace): Promise<void> {
    await processAutonomousLearning(this.deps, trace);
  }
}

export function createLearningWorker(
  deps: LearningWorkerDeps & { gatewayDeps: GatewayDependencies }
): LearningWorker {
  const worker = new LearningWorker({
    ...deps,
    onPackageSaved: async (name) => {
      await deps.packageLibrary.reload(deps.packagesDir);
      if (deps.server) {
        reconcilePackageTools(deps.server, deps.gatewayDeps);
      }
      await deps.onPackageSaved?.(name);
    },
  });

  void recoverOrphanedLearningJobs(deps).catch(() => {
    // recovery is best-effort on startup
  });

  return worker;
}
