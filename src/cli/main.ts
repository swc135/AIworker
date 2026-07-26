#! /usr/bin/env node
import { TaskOrchestrator } from '../core/task_orchestrator';
import type { TaskConfig } from '../types';
import { readTextFile } from '../utils/fs';
import { createLogger } from '../utils/logger';
import { resolve } from 'path';
import { v4 as uuidv4 } from 'uuid';
import * as readline from 'readline';

const logger = createLogger('CLI');

interface CliArgs {
  taskConfig?: string;
  workspace?: string;
  command?: string;
  repl?: boolean;
  help?: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = {};

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--task-config':
        result.taskConfig = args[++i];
        break;
      case '--workspace':
        result.workspace = args[++i];
        break;
      case '--command':
        result.command = args[++i];
        break;
      case '--repl':
      case '-i':
        result.repl = true;
        break;
      case '--help':
      case '-h':
        result.help = true;
        break;
    }
  }

  return result;
}

function printHelp() {
  console.log(`
OpenCode - MonkeyCode-AI 智能开发平台 AI 编程助手

用法:
  opencode [选项]

选项:
  --task-config <path>   任务配置 JSON 文件路径
  --workspace <path>     工作区路径
  --command <cmd>        直接执行命令（非交互模式）
  --repl, -i             启动交互式 REPL 模式
  --help, -h             显示帮助信息

示例:
  opencode --command "hello"
  opencode --workspace /path/to/project --repl
  opencode --task-config /path/to/task.json
`);
}

async function runCommand(orchestrator: TaskOrchestrator, command: string, workspace?: string): Promise<string> {
  const taskConfig: TaskConfig = {
    task_id: uuidv4(),
    session_id: uuidv4(),
    workspace: workspace || process.cwd(),
    autoApprove: true,
    configFiles: [],
    env: { USER_INPUT: command },
  };

  return orchestrator.startTask(taskConfig);
}

async function replMode(orchestrator: TaskOrchestrator, workspace: string) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'opencode> ',
  });

  console.log('OpenCode REPL mode. Type "exit" to quit, "help" for commands.');
  console.log(`Workspace: ${workspace}`);
  console.log(`Skills: ${orchestrator.getSkillRegistry().list().map((s) => s.name).join(', ') || 'none loaded'}`);
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

    if (input === 'help') {
      console.log('Commands: exit/quit, help, skills, rules, status');
      rl.prompt();
      continue;
    }

    if (input === 'skills') {
      const skills = orchestrator.getSkillRegistry().list();
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

    try {
      const response = await runCommand(orchestrator, input, workspace);
      console.log(response);
    } catch (err) {
      console.error(`ERROR: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }

    rl.prompt();
  }

  rl.close();
  console.log('Goodbye.');
}

async function main() {
  const args = parseArgs();

  if (args.help) {
    printHelp();
    return;
  }

  const workspace = args.workspace || process.cwd();
  const orchestrator = new TaskOrchestrator();

  try {
    await orchestrator.initialize(workspace);
  } catch (err) {
    logger.error(`Initialization failed: ${err}`);
    console.error(`Failed to initialize: ${err instanceof Error ? err.message : 'Unknown error'}`);
    process.exit(1);
  }

  if (args.taskConfig) {
    try {
      const raw = await readTextFile(args.taskConfig);
      const taskConfig = JSON.parse(raw) as TaskConfig;
      const response = await orchestrator.startTask(taskConfig);
      console.log(response);
    } catch (err) {
      logger.error(`Task failed: ${err}`);
      console.error(`ERROR: ${err instanceof Error ? err.message : 'Unknown error'}`);
      process.exit(1);
    }
    return;
  }

  if (args.repl) {
    await replMode(orchestrator, workspace);
    return;
  }

  if (args.command) {
    try {
      const response = await runCommand(orchestrator, args.command, workspace);
      console.log(response);
    } catch (err) {
      logger.error(`Command failed: ${err}`);
      console.error(`ERROR: ${err instanceof Error ? err.message : 'Unknown error'}`);
      process.exit(1);
    }
    return;
  }

  // Default: start REPL if no command specified
  await replMode(orchestrator, workspace);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
