export interface Logger {
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
  debug(msg: string, ...args: unknown[]): void;
}

export function createLogger(name: string): Logger {
  const prefix = `[${name}]`;
  return {
    info(msg: string, ...args: unknown[]) {
      console.log(`${prefix} ${msg}`, ...args);
    },
    warn(msg: string, ...args: unknown[]) {
      console.warn(`${prefix} WARN: ${msg}`, ...args);
    },
    error(msg: string, ...args: unknown[]) {
      console.error(`${prefix} ERROR: ${msg}`, ...args);
    },
    debug(msg: string, ...args: unknown[]) {
      if (process.env.OPENCODE_DEBUG) {
        console.debug(`${prefix} DEBUG: ${msg}`, ...args);
      }
    },
  };
}
