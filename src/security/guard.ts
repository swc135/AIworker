import { createLogger } from '@/utils/logger';

const logger = createLogger('Guardrail');

export type ViolationCategory =
  | 'political'
  | 'api_key_extraction'
  | 'cyber_attack'
  | 'network_tunnel'
  | 'abuse'
  | 'third_party_agent'
  | 'keepalive';

export interface Violation {
  category: ViolationCategory;
  summary: string;
  rule: string;
  details: string;
}

type AbuseReporter = (detail: string) => Promise<{ reported: boolean }>;

export class Guardrail {
  private reporter: AbuseReporter;
  private violations: Violation[] = [];
  private blocked: boolean = false;

  constructor(reporter: AbuseReporter) {
    this.reporter = reporter;
  }

  get isBlocked(): boolean {
    return this.blocked;
  }

  async check(input: string): Promise<{ allowed: boolean; violation?: Violation }> {
    const normalized = input.toLowerCase();

    // Check political content
    if (this.detectPolitical(normalized)) {
      return this.reject('political', input, 'guardrail', 'Political/historical content detected');
    }

    // Check API key extraction
    if (this.detectApiKeyExtraction(normalized)) {
      return this.reject('api_key_extraction', input, 'guardrail', 'LLM API key extraction attempt');
    }

    // Check cyber attack patterns
    if (this.detectCyberAttack(normalized)) {
      return this.reject('cyber_attack', input, 'guardrail', 'Cyber attack related content');
    }

    // Check network tunnel
    if (this.detectNetworkTunnel(normalized)) {
      return this.reject('network_tunnel', input, 'guardrail', 'Network tunnel/forwarding content');
    }

    // Check abuse
    if (this.detectAbuse(normalized)) {
      return this.reject('abuse', input, 'guardrail', 'Abuse or gray-market content');
    }

    return { allowed: true };
  }

  private async reject(category: ViolationCategory, summary: string, rule: string, details: string): Promise<{ allowed: boolean; violation: Violation }> {
    const violation: Violation = { category, summary, rule, details };
    this.violations.push(violation);
    logger.warn(`Guardrail violation: ${category} - ${details}`);

    try {
      await this.reporter(`Violation: ${category}, Summary: ${summary}, Rule: ${rule}`);
    } catch {
      // Report failure shouldn't block the guardrail
    }

    this.blocked = true;
    return { allowed: false, violation };
  }

  private detectPolitical(input: string): boolean {
    const keywords = [
      '六四', '天安门', '法轮功', '西藏独立', '新疆独立', '台湾独立',
      'tiananmen', 'falun gong', 'tibet independence', 'xinjiang',
    ];
    return keywords.some((k) => input.includes(k));
  }

  private detectApiKeyExtraction(input: string): boolean {
    const patterns = [
      /api[_\s-]?key/i,
      /MCAI_LLM_API_KEY/i,
      /OPENAI_API_KEY/i,
      /printenv.*key/i,
      /env.*grep.*key/i,
      /os\.getenv.*key/i,
      /read.*\.env.*key/i,
    ];
    return patterns.some((p) => p.test(input));
  }

  private detectCyberAttack(input: string): boolean {
    const keywords = [
      'sql injection', 'xss', 'ddos', 'brute force', 'reverse shell',
      'port scan', 'nmap', 'metasploit', 'exploit', 'payload',
      'ransomware', 'malware', 'backdoor', 'rootkit',
      '漏洞扫描', '端口扫描', '暴力破解', '后门', '木马',
    ];
    return keywords.some((k) => input.includes(k));
  }

  private detectNetworkTunnel(input: string): boolean {
    const keywords = [
      'ssh tunnel', 'reverse proxy', 'socks proxy', 'port forward',
      'ngrok', 'frp', '内网穿透', '隧道', '中继', '跳板',
      'ssh -R', 'ssh -L', 'tcp relay',
    ];
    return keywords.some((k) => input.includes(k));
  }

  private detectAbuse(input: string): boolean {
    const keywords = [
      '批量注册', '刷量', '垃圾信息', '虚假评论', '钓鱼',
      'phishing', 'credential stuffing', 'session hijack',
      'captcha bypass', 'scraping', '数据窃取',
    ];
    return keywords.some((k) => input.includes(k));
  }

  getViolations(): Violation[] {
    return [...this.violations];
  }

  violationCount(): number {
    return this.violations.length;
  }
}
