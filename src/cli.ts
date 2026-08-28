#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Command } from 'commander';

import { formatDoctorReport, runDoctor } from './cli/doctor';
import { runImportAll, runImportFromSources } from './cli/import';
import { formatIndexReport, runIndex } from './cli/index-cmd';
import { runInspect } from './cli/inspect';
import { runRecall } from './cli/recall';
import { runFunctionCommand } from './cli/run';
import { formatSetupReport, runSetup } from './cli/setup';
import { runStats } from './cli/stats';
import { runTestWithExitCode } from './cli/test';
import { formatThisReport, runThis } from './cli/this';
import { startGateway } from './mcp/gateway';
import { findPackageRoot } from './paths';

const packageJson = JSON.parse(
  readFileSync(join(findPackageRoot(import.meta.url), 'package.json'), 'utf-8')
) as { version: string };

const program = new Command();

program
  .name('fn')
  .description('Functhis — local MCP gateway for tool discovery and replay')
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
    '--functions-dir <path>',
    'Functions directory for client MCP snippet (default: ./functions)'
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
      functionsDir?: string;
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
        functionsDir: options.functionsDir,
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
  .option(
    '--functions-dir <path>',
    'Functions directory (default: ./functions)'
  )
  .action(async (options: { dir?: string; functionsDir?: string }) => {
    const result = await runDoctor(options);
    console.log(formatDoctorReport(result));
    if (!result.ok) {
      process.exitCode = 1;
    }
  });

program
  .command('serve')
  .description(
    'Start the stdio MCP gateway (meta-tools plus compiled Functions)'
  )
  .option('--config <path>', 'Path to upstreams.json')
  .option(
    '--functions-dir <path>',
    'Functions directory (default: ./functions)'
  )
  .action(async (options: { config?: string; functionsDir?: string }) => {
    await startGateway({
      configPath: options.config,
      functionsDir: options.functionsDir,
    });
  });

program
  .command('inspect <run-id>')
  .description('Inspect a captured run and its calls')
  .option('--dir <path>', 'Config directory')
  .action(async (runId: string, options: { dir?: string }) => {
    console.log(await runInspect({ dir: options.dir, runId }));
  });

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
  .action(async (options: { dir?: string }) => {
    console.log(await runStats(options));
  });

program
  .command('this <run-id>')
  .description('Compile a successful run into a Function draft')
  .requiredOption('--name <name>', 'Function name (lowercase, hyphens allowed)')
  .option('--dir <path>', 'Config directory')
  .option(
    '--functions-dir <path>',
    'Functions directory (default: ./functions)'
  )
  .option(
    '--calls <addresses>',
    'Comma-separated evidence addresses to compile (default: all succeeded calls)'
  )
  .option('--description <text>', 'Function description')
  .option('--force', 'Overwrite existing function files')
  .action(
    async (
      runId: string,
      options: {
        name: string;
        dir?: string;
        functionsDir?: string;
        calls?: string;
        description?: string;
        force?: boolean;
      }
    ) => {
      const calls = options.calls
        ?.split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
      const result = await runThis({
        calls,
        description: options.description,
        dir: options.dir,
        force: options.force,
        functionsDir: options.functionsDir,
        name: options.name,
        runId,
      });
      console.log(formatThisReport(result));
    }
  );

program
  .command('test <name>')
  .description('Run a Function against its fixture')
  .option('--dir <path>', 'Config directory')
  .option(
    '--functions-dir <path>',
    'Functions directory (default: ./functions)'
  )
  .option('--repeat <n>', 'Repeat count', (value) => Math.trunc(Number(value)))
  .action(
    async (
      name: string,
      options: { dir?: string; functionsDir?: string; repeat?: number }
    ) => {
      const { ok, output } = await runTestWithExitCode({
        dir: options.dir,
        functionsDir: options.functionsDir,
        name,
        repeat: options.repeat,
      });
      console.log(output);
      if (!ok) {
        process.exitCode = 1;
      }
    }
  );

program
  .command('run <name>')
  .description('Replay a Function with fresh input')
  .requiredOption('--input <json>', 'JSON object input')
  .option('--approve-writes', 'Allow Functions with writes: review-required')
  .option('--dir <path>', 'Config directory')
  .option(
    '--functions-dir <path>',
    'Functions directory (default: ./functions)'
  )
  .action(
    async (
      name: string,
      options: {
        input: string;
        approveWrites?: boolean;
        dir?: string;
        functionsDir?: string;
      }
    ) => {
      console.log(
        await runFunctionCommand({
          approveWrites: options.approveWrites,
          dir: options.dir,
          functionsDir: options.functionsDir,
          input: options.input,
          name,
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
