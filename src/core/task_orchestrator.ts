import type { TaskConfig, Message, LLMProvider } from '../types';
import { RuleEngine } from '../rules/engine';
import { SkillLoader, SkillRegistry, SkillExecutor } from '../skills/executor';
import { MCPDispatcher, BuiltinAdapter, InternalAdapter, FileSystemAdapter, WebAdapter } from '../mcp/index';
import { RemoteAdapter } from '../mcp/adapters/remote';
import { SessionManager } from './session';
import { AgentLoop, type AgentContext } from './agent';
import { MockLLMProvider, createProviderFromConfig } from '../llm/index';
import { ConfigLoader } from '../cli/config';
import { Guardrail } from '../security/guard';
import { GitHelper } from '../git/helper';
import { MemorySystem } from './memory';
import { SessionStore } from './session_store';
import { createLogger } from '../utils/logger';
import { MetricsCollector } from '../utils/metrics';
import { TaskProgressTracker } from './progress';
import { resolve } from 'path';

const logger = createLogger('Orchestrator');

const RULES_BASE_PATH = resolve(process.cwd(), '.ai-ready');
const SKILLS_BASE_PATH = resolve(process.cwd(), '.ai-ready/skills');

export class TaskOrchestrator {
  ruleEngine: RuleEngine;
  skillLoader: SkillLoader;
  skillRegistry: SkillRegistry;
  skillExecutor: SkillExecutor;
  mcpDispatcher: MCPDispatcher;
  sessionManager: SessionManager;
  agentLoop: AgentLoop;
  llmProvider: LLMProvider;
  configLoader: ConfigLoader;
  guardrail: Guardrail;
  gitHelper: GitHelper | null = null;
  memorySystem: MemorySystem | null = null;
  sessionStore: SessionStore | null = null;
  metrics: MetricsCollector;
  progressTracker: TaskProgressTracker;
  private workspace: string = process.cwd();

  constructor() {
    this.metrics = new MetricsCollector();
    this.progressTracker = new TaskProgressTracker();
    this.ruleEngine = new RuleEngine(RULES_BASE_PATH);
    this.skillLoader = new SkillLoader();
    this.skillRegistry = new SkillRegistry();
    this.skillExecutor = new SkillExecutor(this.skillRegistry);
    this.mcpDispatcher = new MCPDispatcher();
    this.sessionManager = new SessionManager();
    this.llmProvider = new MockLLMProvider();
    this.agentLoop = new AgentLoop(this.llmProvider, this.mcpDispatcher);
    this.configLoader = new ConfigLoader(this.workspace);

    // Guardrail with abuse reporter that calls the MCP internal adapter
    this.guardrail = new Guardrail(async (detail) => {
      const adapter = this.mcpDispatcher.getAdapter('monkeycode-ai_internal');
      if (adapter) {
        const result = await adapter.execute({
          tool_name: 'monkeycode-ai_internal__report_user_abuse',
          parameters: { abuse_detail: detail },
          call_id: `abuse_${Date.now()}`,
        });
        return { reported: result.success };
      }
      return { reported: false };
    });

    this.registerAdapters();
    this.setupMatchRules();
    this.setupMockResponses();
  }

  private registerAdapters(): void {
    this.mcpDispatcher.registerAdapter(new BuiltinAdapter());
    this.mcpDispatcher.registerAdapter(new InternalAdapter());
    this.mcpDispatcher.registerAdapter(new RemoteAdapter(true));
    this.mcpDispatcher.registerAdapter(new FileSystemAdapter(this.workspace));
    this.mcpDispatcher.registerAdapter(new WebAdapter());
  }

  private setupMatchRules(): void {
    this.skillRegistry.addMatchRule({ keywords: ['deploy', 'preview', 'start server', 'dev'], skillName: 'deploy-website' });
    this.skillRegistry.addMatchRule({ keywords: ['feature', 'requirement', 'design', 'spec', 'ears'], skillName: 'feature-design' });
    this.skillRegistry.addMatchRule({ keywords: ['plan', 'task list', 'implementation plan', 'tasklist'], skillName: 'implementation-planner' });
    this.skillRegistry.addMatchRule({ keywords: ['implement', 'develop', 'code', 'build', 'task'], skillName: 'feature-implementer' });
    this.skillRegistry.addMatchRule({ keywords: ['document', 'wiki', 'docs', 'architecture'], skillName: 'project-wiki' });
    this.skillRegistry.addMatchRule({ keywords: ['publish', 'release', 'showcase'], skillName: 'publish-website' });
  }

  private setupMockResponses(): void {
    if (!(this.llmProvider instanceof MockLLMProvider)) return;
    this.llmProvider.setResponse('hello', ['Hello! I am OpenCode, your AI coding assistant on the MonkeyCode-AI platform.']);
    this.llmProvider.setResponse('help', [
      'I can help you with:\n- Coding and debugging\n- Deploying and previewing web projects\n- Feature design with EARS patterns\n- Implementation planning\n- Project documentation\n- Publishing to Showcase',
    ]);
    this.llmProvider.setResponse('deploy', [
      'I will deploy your project. Let me detect the project type and start a development server with preview.',
    ]);
    this.llmProvider.setResponse('search', [
      'Let me search for that information on the web for you.',
    ]);
  }

  async initialize(workspace?: string): Promise<void> {
    if (workspace) this.workspace = workspace;
    logger.info(`Initializing TaskOrchestrator for ${this.workspace}...`);

    // Load config
    const config = await this.configLoader.load();
    logger.info(`Model: ${config.model}`);

    // Create LLM provider from config
    if (config.modelConfig?.provider && config.modelConfig?.apiKey) {
      const provider = createProviderFromConfig({
        name: config.modelConfig.provider,
        model: config.modelConfig.model || config.model,
        baseURL: config.modelConfig.baseURL || 'https://api.openai.com/v1',
        apiKey: config.modelConfig.apiKey,
      });
      if (provider) {
        this.llmProvider = provider;
        this.agentLoop = new AgentLoop(this.llmProvider, this.mcpDispatcher);
        logger.info(`Using provider: ${config.modelConfig.provider}`);
      }
    } else {
      this.setupMockResponses();
    }

    // Connect metrics collector
    this.agentLoop.setMetrics(this.metrics);

    // Load rules from global and project paths
    for (const pattern of config.instructions) {
      await this.ruleEngine.loadFromGlob(pattern);
    }
    logger.info(`Loaded ${this.ruleEngine.rulesList.length} rules`);

    // Load skills
    const skills = await this.skillLoader.loadFromPaths([
      SKILLS_BASE_PATH,
      resolve(this.workspace, '.ai-ready/skills'),
    ]);
    this.skillRegistry.registerAll(skills);
    logger.info(`Loaded ${skills.length} skills`);

    // Initialize git helper
    this.gitHelper = new GitHelper(this.workspace);
    await this.gitHelper.initSubmodules();

    // Session store for persistence
    this.sessionStore = new SessionStore(this.workspace);
    await this.sessionStore.loadAll();

    // Load memory
    this.memorySystem = new MemorySystem(this.workspace);
    await this.memorySystem.load();
  }

  async startTask(taskConfig: TaskConfig): Promise<string> {
    logger.info(`Starting task: ${taskConfig.task_id}`);

    // Progress tracking
    this.progressTracker.start(taskConfig.task_id, taskConfig.env.USER_INPUT || taskConfig.task_id);

    // Guardrail check
    const userInput = taskConfig.env.USER_INPUT || '';
    if (userInput) {
      const check = await this.guardrail.check(userInput);
      this.progressTracker.recordGuardrailCheck(taskConfig.task_id, check.allowed, check.violation?.category);
      if (!check.allowed) {
        logger.warn(`Task blocked by guardrail: ${check.violation?.category}`);
        return this.getViolationResponse(check.violation?.category);
      }
    }

    // Create session
    const session = this.sessionManager.create(taskConfig);
    if (this.gitHelper) this.gitHelper = new GitHelper(taskConfig.workspace);

    // Build system prompt
    const basePrompt = 'You are OpenCode, an AI coding assistant on the MonkeyCode-AI platform.';
    const systemPrompt = this.ruleEngine.injectToContext(basePrompt);

    // Collect all tool definitions
    const tools = this.mcpDispatcher.listAllTools();

    const messages: Message[] = [
      { role: 'system', content: systemPrompt },
    ];

    // Inject config file rules
    if (taskConfig.configFiles.length > 0) {
      const ruleContents = taskConfig.configFiles
        .map((f) => `Instructions from: ${f.path}\n\n${f.content}`)
        .join('\n\n---\n\n');
      messages.push({ role: 'system', content: ruleContents });
    }

    // Memory injection
    if (this.memorySystem) {
      const entries = await this.memorySystem.load();
      if (entries.length > 0) {
        const memoryContent = entries
          .map((e) => `Memory: ${e.summary}\n${e.instructions.map((i) => `  - ${i}`).join('\n')}`)
          .join('\n\n');
        messages.push({ role: 'system', content: `User preferences from memory:\n${memoryContent}` });
      }
    }

    // Skill matching
    const matchedSkill = this.skillRegistry.matchBest(userInput);
    if (matchedSkill) {
      messages.push({
        role: 'system',
        content: `Matched skill: ${matchedSkill.name}\nVersion: ${matchedSkill.version}\n\nSkill instructions:\n${matchedSkill.instructions}`,
      });
      logger.info(`Matched skill: ${matchedSkill.name}`);
    }

    // Add user input
    if (userInput) {
      messages.push({ role: 'user', content: userInput });
    }

    const context: AgentContext = {
      messages,
      tools,
      systemPrompt,
    };

    // Wire progress tracker into agent loop
    this.agentLoop.setProgressTracker(this.progressTracker, taskConfig.task_id);

    // Run agent loop
    const startTime = Date.now();
    this.metrics.recordTask();
    try {
      const result = await this.agentLoop.run(context);
      this.sessionManager.updateStatus(session.session_id, 'idle');

      // Persist session with conversation history
      if (this.sessionStore) {
        await this.sessionStore.save({
          session_id: session.session_id,
          task_id: taskConfig.task_id,
          created_at: session.created_at,
          messages: result.messages,
        });
      }

      logger.info(`Task ${taskConfig.task_id} completed`);
      this.progressTracker.complete(taskConfig.task_id);
      return result.finalContent;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      this.metrics.recordAPIEvent({
        toolName: `task_${taskConfig.task_id}`,
        success: false,
        durationMs: Date.now() - startTime,
        error: errorMessage,
      });
      throw err;
    } finally {
      this.metrics.recordAPIEvent({
        toolName: `task_${taskConfig.task_id}`,
        success: true,
        durationMs: Date.now() - startTime,
      });
    }
  }

  private getViolationResponse(category?: string): string {
    switch (category) {
      case 'political':
        return '该请求涉及违规内容，我不能继续执行。';
      case 'api_key_extraction':
        return '该请求涉及获取当前环境中的大模型 API Key，我不能协助执行。继续尝试获取大模型 API Key 可能导致账号被封禁。';
      case 'cyber_attack':
        return '该请求涉及网络安全攻击类行为，MonkeyCode 禁止这类行为，我不能协助执行。如需处理网络安全类场景，建议使用专门设计的 MonkeyScan：https://scan.monkeycode-ai.com/?utm_source=monkeycode';
      case 'network_tunnel':
        return '该请求涉及使用 Agent 执行环境建立网络隧道、代理或流量转发通道，属于违规使用场景，我不能协助执行。';
      default:
        return '该请求涉及违规使用平台能力，我不能协助执行。';
    }
  }

  getSessionManager(): SessionManager { return this.sessionManager; }
  getMCPDispatcher(): MCPDispatcher { return this.mcpDispatcher; }
  getSkillRegistry(): SkillRegistry { return this.skillRegistry; }
  getGuardrail(): Guardrail { return this.guardrail; }
  getGitHelper(): GitHelper | null { return this.gitHelper; }
  getMemorySystem(): MemorySystem | null { return this.memorySystem; }
  getProgressTracker(): TaskProgressTracker { return this.progressTracker; }
}
