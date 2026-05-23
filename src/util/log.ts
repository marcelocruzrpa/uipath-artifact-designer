/**
 * Diagnostic logging for the extension host.
 *
 * Errors are surfaced to users as transient toasts, which disappear before a
 * user can act on them and carry no stack trace. This routes the same errors
 * (and warnings) to a persistent "UiPath Artifact Designer" output channel so
 * issues can be diagnosed and reported.
 */
import * as vscode from 'vscode';

let channel: vscode.OutputChannel | undefined;

/**
 * Creates the extension's output channel. Call once from `activate`; the
 * channel is registered for disposal on the extension context.
 */
export function initLog(context: vscode.ExtensionContext): void {
  channel = vscode.window.createOutputChannel('UiPath Artifact Designer');
  context.subscriptions.push(channel);
}

function write(level: 'info' | 'warn' | 'error', message: string): void {
  const line = `[${new Date().toISOString()}] [${level}] ${message}`;
  // Falls back to the console when called before activate() (e.g. in tests).
  if (channel) {
    channel.appendLine(line);
  } else {
    console.log(line);
  }
}

/** Logs an informational message. */
export function logInfo(message: string): void {
  write('info', message);
}

/** Logs a warning. */
export function logWarn(message: string): void {
  write('warn', message);
}

/** Logs an error, appending the message and stack trace when available. */
export function logError(message: string, error?: unknown): void {
  let line = message;
  if (error instanceof Error) {
    line += ` — ${error.message}`;
    if (error.stack) {
      line += `\n${error.stack}`;
    }
  } else if (error !== undefined) {
    line += ` — ${String(error)}`;
  }
  write('error', line);
}
