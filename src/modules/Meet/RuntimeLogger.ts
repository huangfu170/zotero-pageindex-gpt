import { config } from "../../../package.json";

type LogLevel = "debug" | "info" | "warn" | "error";

type LogEntry = {
  time: string;
  level: LogLevel;
  scope: string;
  event: string;
  data?: unknown;
};

const MAX_PREVIEW_LENGTH = 2000;

let logFilePath: string | undefined;
let writeQueue = Promise.resolve();

function getLogDirectory() {
  const temp = Zotero.getTempDirectory();
  return temp.path.replace(temp.leafName, "");
}

function getLogFilePath(): string {
  if (!logFilePath) {
    const window = Zotero.getMainWindow() as any;
    logFilePath = window.OS.Path.join(getLogDirectory(), `${config.addonRef}.runtime.log`);
  }
  return logFilePath as string;
}

function stringifyData(data: unknown) {
  if (data === undefined) {
    return "";
  }
  try {
    const text = typeof data === "string" ? data : JSON.stringify(data);
    return text.length > MAX_PREVIEW_LENGTH ? `${text.slice(0, MAX_PREVIEW_LENGTH)}...` : text;
  } catch {
    return String(data);
  }
}

function formatEntry(entry: LogEntry) {
  const data = stringifyData(entry.data);
  return `[${entry.time}] [${entry.level.toUpperCase()}] [${entry.scope}] ${entry.event}${data ? ` ${data}` : ""}\n`;
}

async function appendLine(line: string) {
  const path = getLogFilePath();
  let current = "";
  try {
    current = (await Zotero.File.getContentsAsync(path)) as string;
  } catch {
    current = "";
  }
  await Zotero.File.putContentsAsync(path, `${current}${line}`);
}

export function getRuntimeLogPath() {
  return getLogFilePath();
}

export async function readRuntimeLog() {
  return (await Zotero.File.getContentsAsync(getLogFilePath())) as string;
}

export function runtimeLog(
  scope: string,
  event: string,
  data?: unknown,
  level: LogLevel = "info",
) {
  const entry = {
    time: new Date().toISOString(),
    level,
    scope,
    event,
    data,
  };
  const line = formatEntry(entry);

  try {
    ztoolkit.log(line.trim());
  } catch {}
  try {
    const logger = level === "error"
      ? console.error
      : level === "warn"
        ? console.warn
        : console.info;
    logger.call(console, line.trim());
  } catch {}

  writeQueue = writeQueue
    .then(() => appendLine(line))
    .catch((error) => {
      try {
        ztoolkit.log("[RuntimeLogger] write failed", error);
      } catch {}
    });
}

export async function withRuntimeLog<T>(
  scope: string,
  event: string,
  data: unknown,
  action: () => Promise<T>,
) {
  const startedAt = Date.now();
  runtimeLog(scope, `${event}:start`, data);
  try {
    const result = await action();
    runtimeLog(scope, `${event}:end`, {
      elapsedMs: Date.now() - startedAt,
      result: summarizeValue(result),
    });
    return result;
  } catch (error: any) {
    runtimeLog(scope, `${event}:error`, {
      elapsedMs: Date.now() - startedAt,
      message: error?.message || String(error),
      stack: error?.stack,
    }, "error");
    throw error;
  }
}

export function summarizeValue(value: unknown, maxLength = 600) {
  if (Array.isArray(value)) {
    return { type: "array", length: value.length, preview: stringifyData(value.slice(0, 3)) };
  }
  if (value && typeof value === "object") {
    const objectValue = value as any;
    if (Array.isArray(objectValue.docs)) {
      return {
        type: "object",
        docs: objectValue.docs.length,
        textLength: typeof objectValue.text === "string" ? objectValue.text.length : undefined,
      };
    }
  }
  const text = stringifyData(value);
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}
