#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Command } from 'commander';

import { formatDoctorReport, runDoctor } from './cli/doctor';
import { runFunctionsTest } from './cli/functions';
import { runImportAll, runImportFromSources } from './cli/import';
import { formatIndexReport, runIndex } from './cli/index-cmd';
import { runInspect } from './cli/inspect';
import { runRecall } from './cli/recall';
import { formatSetupReport, runSetup } from './cli/setup';
import { runStats } from './cli/stats';
import {
  runTracesCompile,
  runTracesInspect,
  runTracesList,
} from './cli/traces';
import { startGateway } from './mcp/gateway';
import { findPackageRoot } from './paths';

const packageJson = JSON.parse(
  readFileSync(join(findPackageRoot(import.meta.url), 'package.json'), 'utf-8')
) as { version: string };

const program = new Command();

program
  .name('fn')
  .description('Functhis — local MCP gateway with sandbox packages')
  .version(packageJson.version);

const importCmd = program
  .command('import')
  .description(
    'Import stdio MCP servers from Cursor, Claude, OpenCode, and other client configs'
  )
  .option('--dir <path>', 'Functhis config directory')
  .option('--no-merge', 'Replace upstreams instead of merging by id')
  .option('--dry-run', 'Print import plan without writing config')
  .action(
    async (options: { dir?: string; merge?: boolean; dryRun?: boolean }) => {
      const result = await runImportAll({
        dir: options.dir,
        dryRun: options.dryRun,
        merge: options.merge,
      });
      console.log(result.report);
    }
  );

importCmd
  .command('mcp-json <path>')
  .description('Import stdio MCP servers from any mcp.json-style file')
  .option('--dir <path>', 'Functhis config directory')
  .option('--no-merge', 'Replace upstreams instead of merging by id')
  .option('--dry-run', 'Print import plan without writing config')
  .action(
    async (
      path: string,
      options: { dir?: string; merge?: boolean; dryRun?: boolean }
    ) => {
      const result = await runImportFromSources({
        dir: options.dir,
        dryRun: options.dryRun,
        merge: options.merge,
        sources: [{ client: 'mcp-json', path, scope: 'project' }],
      });
      console.log(result.report);
    }
  );

importCmd
  .command('cursor')
  .description(
    'Import stdio MCP servers from Cursor (~/.cursor/mcp.json and .cursor/mcp.json)'
  )
  .option('--dir <path>', 'Functhis config directory')
  .option('--no-merge', 'Replace upstreams instead of merging by id')
  .option('--dry-run', 'Print import plan without writing config')
  .action(
    async (options: { dir?: string; merge?: boolean; dryRun?: boolean }) => {
      const result = await runImportFromSources({
        dir: options.dir,
        dryRun: options.dryRun,
        merge: options.merge,
      });
      console.log(result.report);
    }
  );

program
  .command('setup')
  .description('Create a starter upstreams.json configuration')
  .option(
    '--dir <path>',
    'Config directory (default: ~/.functhis or .functhis)'
  )
  .option('--dry-run', 'Print planned changes without writing files')
  .option('--force', 'Overwrite existing config (creates a backup first)')
  .option(
    '--packages-dir <path>',
    'Packages directory for client MCP snippet (default: ./packages)'
  )
  .option(
    '--write-client <target>',
    'Merge functhis into client MCP config (cursor, claude, or opencode)'
  )
  .action(
    async (options: {
      dir?: string;
      dryRun?: boolean;
      force?: boolean;
      packagesDir?: string;
      writeClient?: string;
    }) => {
      const writeClient = options.writeClient
        ? [options.writeClient as 'cursor' | 'claude' | 'opencode']
        : undefined;
      if (
        writeClient &&
        !writeClient.every(
          (target) =>
            target === 'cursor' || target === 'claude' || target === 'opencode'
        )
      ) {
        throw new Error(
          '--write-client must be "cursor", "claude", or "opencode"'
        );
      }
      const result = await runSetup({
        dir: options.dir,
        dryRun: options.dryRun,
        force: options.force,
        packagesDir: options.packagesDir,
        writeClient,
      });
      console.log(formatSetupReport(result));
    }
  );

program
  .command('index')
  .description(
    'Incrementally index the TypeScript repository into the knowledge graph'
  )
  .option('--dir <path>', 'Functhis config directory')
  .option('--force', 'Reindex all files regardless of content hash')
  .option('--root <path>', 'Repository root (default: cwd)')
  .option('--include <paths...>', 'Path prefixes to include (default: src)')
  .action(
    async (options: {
      dir?: string;
      force?: boolean;
      include?: string[];
      root?: string;
    }) => {
      const { report } = await runIndex({
        dir: options.dir,
        force: options.force,
        include: options.include,
        root: options.root,
      });
      console.log(formatIndexReport(report));
    }
  );

program
  .command('doctor')
  .description('Validate config and test upstream MCP connections')
  .option('--dir <path>', 'Config directory')
  .option('--packages-dir <path>', 'Packages directory (default: ./packages)')
  .action(async (options: { dir?: string; packagesDir?: string }) => {
    const result = await runDoctor(options);
    console.log(formatDoctorReport(result));
    if (!result.ok) {
      process.exitCode = 1;
    }
  });

program
  .command('serve')
  .description('Start the stdio MCP gateway (meta-tools plus saved packages)')
  .option('--config <path>', 'Path to upstreams.json')
  .option('--packages-dir <path>', 'Packages directory (default: ./packages)')
  .action(async (options: { config?: string; packagesDir?: string }) => {
    await startGateway({
      configPath: options.config,
      packagesDir: options.packagesDir,
    });
  });

program
  .command('inspect <run-id>')
  .description('Inspect a captured run and its calls')
  .option('--dir <path>', 'Config directory')
  .action(async (runId: string, options: { dir?: string }) => {
    console.log(await runInspect({ dir: options.dir, runId }));
  });

const tracesCmd = program
  .command('traces')
  .description('List, inspect, and compile captured gateway traces');

tracesCmd
  .command('list')
  .description('List recent captured traces')
  .option('--dir <path>', 'Config directory')
  .option('--limit <n>', 'Maximum traces to list', '20')
  .action(async (options: { dir?: string; limit?: string }) => {
    console.log(
      await runTracesList({
        dir: options.dir,
        limit: Number(options.limit ?? 20),
      })
    );
  });

tracesCmd
  .command('inspect <run-id>')
  .description('Inspect a trace with dataflow details')
  .option('--dir <path>', 'Config directory')
  .action(async (runId: string, options: { dir?: string }) => {
    console.log(await runTracesInspect({ dir: options.dir, runId }));
  });

tracesCmd
  .command('compile <run-id>')
  .description('Compile a trace into a function brief and skeleton')
  .requiredOption('--name <name>', 'Package name for the compiled function')
  .option('--description <text>', 'Package description')
  .option('--dir <path>', 'Config directory')
  .action(
    async (
      runId: string,
      options: { description?: string; dir?: string; name: string }
    ) => {
      console.log(
        await runTracesCompile({
          description: options.description,
          dir: options.dir,
          name: options.name,
          runId,
        })
      );
    }
  );

const functionsCmd = program
  .command('functions')
  .description('Test saved function packages');

functionsCmd
  .command('test <name>')
  .description('Verify a saved function package locally')
  .option('--dir <path>', 'Config directory')
  .option('--packages-dir <path>', 'Packages directory')
  .option('--mode <mode>', 'replay or live', 'replay')
  .option('--compiled-from <run-id>', 'Source trace for replay mode')
  .option('--approve-writes', 'Allow live testing of write-capable tools')
  .action(
    async (
      name: string,
      options: {
        approveWrites?: boolean;
        compiledFrom?: string;
        dir?: string;
        mode?: 'live' | 'replay';
        packagesDir?: string;
      }
    ) => {
      console.log(
        await runFunctionsTest({
          approveWrites: options.approveWrites,
          compiledFrom: options.compiledFrom,
          dir: options.dir,
          mode: options.mode,
          name,
          packagesDir: options.packagesDir,
        })
      );
    }
  );

program
  .command('recall <run-id> <address>')
  .description(
    'Recall stored evidence from a run without repeating the upstream call'
  )
  .option('--dir <path>', 'Config directory')
  .action(async (runId: string, address: string, options: { dir?: string }) => {
    console.log(await runRecall({ address, dir: options.dir, runId }));
  });

program
  .command('stats')
  .description('Show local run statistics')
  .option('--dir <path>', 'Config directory')
  .option('--function <name>', 'Stats for a saved function package')
  .option('--tool <id>', 'Stats for an upstream tool id')
  .action(
    async (options: { dir?: string; function?: string; tool?: string }) => {
      console.log(
        await runStats({
          dir: options.dir,
          functionName: options.function,
          toolId: options.tool,
        })
      );
    }
  );

try {
  await program.parseAsync(process.argv);
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
}
