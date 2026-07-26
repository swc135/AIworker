#! /usr/bin/env node
import { Command } from 'commander';
import { TaskOrchestrator } from '../core/task_orchestrator';
import type { TaskConfig } from '../types';
import { readTextFile, safeReadTextFile } from '@/utils/fs';
import { createLogger } from '@/utils/logger';
import { resolve } from 'path';
import { v4 as uuidv4 } from 'uuid';
import * as readline from 'readline';

const logger = createLogger('CLI');

const program = new Command();

program
  .name('aiworker')
  .description('OpenCode - MonkeyCode-AI 智能开发平台 AI 编程助手')
  .version('1.0.0');

program
  .command('task <message>')
  .description('Execute a task or chat message')
  .option('-w, --workspace <path>', 'Workspace directory', process.cwd())
  .option('--model <provider>', 'Override model provider name')
  .option('--metrics', 'Show metrics after completion')
  .action(async (message: string, options: { workspace: string; model?: string; metrics?: boolean }) => {
    const orchestrator = new TaskOrchestrator();
    try {
      await orchestrator.initialize(options.workspace);
    } catch (err) {
      logger.error(`Init failed: ${err}`);
      console.error(`Failed to initialize: ${(err as Error).message}`);
      process.exit(1);
    }

    const taskConfig: TaskConfig = {
      task_id: uuidv4(),
      session_id: uuidv4(),
      workspace: options.workspace,
      autoApprove: true,
      configFiles: [],
      env: { USER_INPUT: message },
    };

    try {
      const response = await orchestrator.startTask(taskConfig);
      console.log(response);

      if (options.metrics && orchestrator.metrics) {
        console.log('\n' + orchestrator.metrics.getSummary());
      }
    } catch (err) {
      console.error(`Task failed: ${(err as Error).message}`);
      process.exit(1);
    }
  });

program
  .command('repl')
  .description('Start interactive REPL mode')
  .option('-w, --workspace <path>', 'Workspace directory', process.cwd())
  .action(async (options: { workspace: string }) => {
    const orchestrator = new TaskOrchestrator();
    try {
      await orchestrator.initialize(options.workspace);
    } catch (err) {
      logger.error(`Init failed: ${err}`);
      console.error(`Failed to initialize: ${(err as Error).message}`);
      process.exit(1);
    }
    await replMode(orchestrator, options.workspace);
  });

program
  .command('config')
  .description('Show current configuration')
  .option('-w, --workspace <path>', 'Workspace directory', process.cwd())
  .action(async (options: { workspace: string }) => {
    const configLoader = await import('@/cli/config');
    const loader = new configLoader.ConfigLoader(options.workspace);
    const config = await loader.load();
    console.log(JSON.stringify({
      model: config.model,
      instructions: config.instructions,
      skills: config.skills,
      providers: Object.keys(config.provider),
    }, null, 2));
  });

program
  .command('info')
  .description('Show system info and capabilities')
  .option('-w, --workspace <path>', 'Workspace directory', process.cwd())
  .action(async (options: { workspace: string }) => {
    const orchestrator = new TaskOrchestrator();
    try {
      await orchestrator.initialize(options.workspace);
    } catch (err) {
      logger.error(`Init failed: ${err}`);
      console.error(`Failed to initialize: ${(err as Error).message}`);
      process.exit(1);
    }

    const mcpDispatcher = orchestrator.getMCPDispatcher();
    const skillRegistry = orchestrator.getSkillRegistry();
    const tools = mcpDispatcher.listAllTools();
    const skills = skillRegistry.list();
    const rules = orchestrator.ruleEngine.rulesList;

    console.log('=== System Info ===');
    console.log(`Workspace:     ${options.workspace}`);
    console.log(`MCP Tools:     ${tools.length} (${mcpDispatcher.listAdapters().join(', ')})`);
    console.log(`Skills:        ${skills.length} (${skills.map((s) => s.name).join(', ') || 'none'})`);
    console.log(`Rules loaded:  ${rules.length}`);
    const guardrail = orchestrator.getGuardrail();
    console.log(`Guardrail:     ${guardrail.violationCount()} violation categories`);
    if (orchestrator.metrics) {
      console.log('--- Metrics ---');
      console.log(orchestrator.metrics.getSummary());
    }
  });

async function replMode(orchestrator: TaskOrchestrator, workspace: string) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'opencode> ',
  });

  const tools = orchestrator.getMCPDispatcher().listAllTools();
  const skills = orchestrator.getSkillRegistry().list();
  const ruleCount = orchestrator.ruleEngine.rulesList.length;

  console.log(`OpenCode REPL mode. Type "exit" to quit.`);
  console.log(`Workspace: ${workspace}`);
  console.log(`Tools: ${tools.length} | Skills: ${skills.length} | Rules: ${ruleCount}`);
  console.log('Commands: exit/quit, help, skills, rules, tools, status, metrics, clear, config');
  rl.prompt();

  for await (const line of rl) {
    const input = line.trim();

    if (!input) {
      rl.prompt();
      continue;
    }

    if (input === 'exit' || input === 'quit') {
      break;
    }

    if (input === 'clear') {
      process.stdout.write('\x1B[2J\x1B[0f');
      rl.prompt();
      continue;
    }

    if (input === 'help') {
      console.log('\nAvailable commands:');
      console.log('  skills      - List registered skills');
      console.log('  rules       - List loaded rules');
      console.log('  tools       - List available MCP tools');
      console.log('  status      - Show session status');
      console.log('  metrics     - Show system metrics');
      console.log('  config      - Show configuration');
      console.log('  clear       - Clear screen');
      console.log('  exit/quit   - Exit REPL');
      console.log('  Any other text is sent as a task message.\n');
      rl.prompt();
      continue;
    }

    if (input === 'skills') {
      for (const s of skills) {
        console.log(`  ${s.name} (v${s.version}) - ${s.description}`);
      }
      rl.prompt();
      continue;
    }

    if (input === 'rules') {
      const rules = orchestrator.ruleEngine.rulesList;
      for (const r of rules) {
        console.log(`  [${r.category}] ${r.filename} (priority: ${r.priority})`);
      }
      console.log(`  Total: ${rules.length} rules loaded\n`);
      rl.prompt();
      continue;
    }

    if (input === 'tools') {
      for (const t of tools) {
        const parts = t.name.split('__').pop() || t.name;
        console.log(`  ${parts}`);
      }
      console.log(`  Total: ${tools.length} tools\n`);
      rl.prompt();
      continue;
    }

    if (input === 'status') {
      const session = orchestrator.getSessionManager().getCurrent();
      console.log(`  Session: ${session?.session_id || 'none'}`);
      console.log(`  Status: ${session?.status || 'N/A'}`);
      rl.prompt();
      continue;
    }

    if (input === 'metrics') {
      if (orchestrator.metrics) {
        console.log('\n' + orchestrator.metrics.getSummary());
      } else {
        console.log('Metrics not available.');
      }
      rl.prompt();
      continue;
    }

    if (input === 'config') {
      try {
        const configLoader = await import('@/cli/config');
        const loader = new configLoader.ConfigLoader(workspace);
        const config = await loader.load();
        console.log(JSON.stringify({
          model: config.model,
          instructions: config.instructions,
          skills: config.skills,
          providers: Object.keys(config.provider),
        }, null, 2));
      } catch {
        console.log('No config file found.');
      }
      rl.prompt();
      continue;
    }

    try {
      const response = await orchestrator.startTask({
        task_id: uuidv4(),
        session_id: uuidv4(),
        workspace,
        autoApprove: true,
        configFiles: [],
        env: { USER_INPUT: input },
      });
      console.log(response);
    } catch (err) {
      console.error(`ERROR: ${(err as Error).message}`);
    }

    rl.prompt();
  }

  rl.close();
  console.log('Goodbye.');
}

program.parse();
