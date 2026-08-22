/**
 * Structured logger: JSON lines to file + human-readable console output.
 * Every agent action lands here — the overnight log's raw feed.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export class Logger {
  private filePath: string | null = null;
  private consoleLevel: LogLevel = "info";
  private fileLevel: LogLevel = "debug";
  private scopeStack: string[] = [];

  useFile(dir: string, name = "studio.log"): void {
    mkdirSync(dir, { recursive: true });
    this.filePath = join(dir, name);
  }

  pushScope(scope: string): void {
    this.scopeStack.push(scope);
  }

  popScope(): void {
    this.scopeStack.pop();
  }

  setConsoleLevel(level: LogLevel): void {
    this.consoleLevel = level;
  }

  scoped(scope: string): ScopedLogger {
    return new ScopedLogger(this, [...this.scopeStack, scope].join("::"));
  }

  // Root-level convenience methods (pipeline use).
  debug(message: string, data?: Record<string, unknown>): void {
    this.log("debug", "", message, data);
  }
  info(message: string, data?: Record<string, unknown>): void {
    this.log("info", "", message, data);
  }
  warn(message: string, data?: Record<string, unknown>): void {
    this.log("warn", "", message, data);
  }
  error(message: string, data?: Record<string, unknown>): void {
    this.log("error", "", message, data);
  }

  log(level: LogLevel, scope: string, message: string, data?: Record<string, unknown>): void {
    const rec = {
      t: new Date().toISOString(),
      level,
      scope: [this.scopeStack.join("::"), scope].filter(Boolean).join("::"),
      message,
      ...data,
    };
    if (LEVEL_ORDER[level] >= LEVEL_ORDER[this.consoleLevel]) {
      const line = `[${rec.t.slice(11, 19)}] ${level.toUpperCase().padEnd(5)} ${rec.scope}: ${message}`;
      if (level === "error") console.error(line);
      else if (level === "warn") console.warn(line);
      else console.log(line);
      if (data && Object.keys(data).length > 0 && level !== "debug") {
        console.log("        " + JSON.stringify(data).slice(0, 300));
      }
    }
    if (this.filePath && LEVEL_ORDER[level] >= LEVEL_ORDER[this.fileLevel]) {
      try {
        appendFileSync(this.filePath, JSON.stringify(rec) + "\n");
      } catch {
        // Logging must never crash the studio.
      }
    }
  }
}

export class ScopedLogger {
  constructor(private parent: Logger, private scope: string) {}
  debug(msg: string, data?: Record<string, unknown>): void {
    this.parent.log("debug", this.scope, msg, data);
  }
  info(msg: string, data?: Record<string, unknown>): void {
    this.parent.log("info", this.scope, msg, data);
  }
  warn(msg: string, data?: Record<string, unknown>): void {
    this.parent.log("warn", this.scope, msg, data);
  }
  error(msg: string, data?: Record<string, unknown>): void {
    this.parent.log("error", this.scope, msg, data);
  }
}
