import * as vscode from "vscode";

const output = vscode.window.createOutputChannel("JSX Info");

function baseLog(level: string, ...data: any[]) {
  const time = new Date().toLocaleTimeString();
  const str = data.map(format).join(" ");
  output.appendLine(`[${time}] [${level}] ${str}`);
}

function format(item: unknown): string {
  if (typeof item === "object" && item !== null) {
    return JSON.stringify(item, null, 2);
  }
  return String(item);
}

export function info(...data: any[]): void {
  baseLog("info", ...data);
}

export function warn(...data: any[]): void {
  baseLog("warn", ...data);
}

export function fail(...data: any[]): void {
  baseLog("fail", ...data);
}
