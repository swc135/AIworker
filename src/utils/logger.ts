export interface Logger {
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
  debug(msg: string, ...args: unknown[]): void;
}

type LogLevelName = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Readonly<Record<LogLevelName, number>> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let globalLevel = LOG_LEVELS.info;

const levelNames: readonly LogLevelName[] = ['debug', 'info', 'warn', 'error'];

const isLogLevel = (val: string): val is LogLevelName =>
  val.length > 0 && levelNames.some((n) => n === val);

try {
  const envLevel = process.env.OPENCODE_LOG_LEVEL;
  if (typeof envLevel === 'string' && isLogLevel(envLevel)) {
    globalLevel = LOG_LEVELS[envLevel];
  }
} catch {
  // ignore invalid log level
}

export function setLogLevel(level: LogLevelName): void {
  globalLevel = LOG_LEVELS[level];
}

export function createLogger(name: string): Logger {
  const prefix = `[${name}]`;
  return {
    info(msg: string, ...args: unknown[]) {
      if (globalLevel <= LOG_LEVELS.info) console.log(`${prefix} ${msg}`, ...args);
    },
    warn(msg: string, ...args: unknown[]) {
      if (globalLevel <= LOG_LEVELS.warn) console.warn(`${prefix} WARN: ${msg}`, ...args);
    },
    error(msg: string, ...args: unknown[]) {
      if (globalLevel <= LOG_LEVELS.error) console.error(`${prefix} ERROR: ${msg}`, ...args);
    },
    debug(msg: string, ...args: unknown[]) {
      if (process.env.OPENCODE_DEBUG && globalLevel <= LOG_LEVELS.debug) {
        console.debug(`${prefix} DEBUG: ${msg}`, ...args);
      }
    },
  };
}
