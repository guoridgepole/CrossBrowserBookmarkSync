/**
 * Structured logger with level support.
 */

type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

let currentLevel: LogLevel = 'INFO';

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[currentLevel];
}

function formatMessage(level: LogLevel, message: string): string {
  const timestamp = new Date().toISOString();
  return `[${timestamp}] [${level}] [CrossBrowserBookmarkSync] ${message}`;
}

export const logger = {
  debug(message: string): void {
    if (shouldLog('DEBUG')) {
      console.debug(formatMessage('DEBUG', message));
    }
  },

  info(message: string): void {
    if (shouldLog('INFO')) {
      console.info(formatMessage('INFO', message));
    }
  },

  warn(message: string): void {
    if (shouldLog('WARN')) {
      console.warn(formatMessage('WARN', message));
    }
  },

  error(message: string): void {
    if (shouldLog('ERROR')) {
      console.error(formatMessage('ERROR', message));
    }
  },
};
