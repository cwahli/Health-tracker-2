// Centralized Logger Module for Server and Client Telemetry

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function getActiveLogLevel(): number {
  const envLevel = (process.env.LOG_LEVEL || 'info').toLowerCase() as LogLevel;
  return LOG_LEVELS[envLevel] ?? 1;
}

export class Logger {
  private levelIndex: number;

  constructor() {
    this.levelIndex = getActiveLogLevel();
  }

  public setLevel(level: LogLevel) {
    this.levelIndex = LOG_LEVELS[level] ?? 1;
  }

  public debug(message: string, ...args: any[]) {
    if (this.levelIndex <= LOG_LEVELS.debug) {
      console.log(`[DEBUG] ${message}`, ...args);
    }
  }

  public info(message: string, ...args: any[]) {
    if (this.levelIndex <= LOG_LEVELS.info) {
      console.log(`[INFO] ${message}`, ...args);
    }
  }

  public warn(message: string, ...args: any[]) {
    if (this.levelIndex <= LOG_LEVELS.warn) {
      console.warn(`[WARN] ${message}`, ...args);
    }
  }

  public error(message: string, ...args: any[]) {
    if (this.levelIndex <= LOG_LEVELS.error) {
      console.error(`[ERROR] ${message}`, ...args);
    }
  }
}

export const logger = new Logger();
