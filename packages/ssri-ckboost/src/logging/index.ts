import BeautifyConsoleImport from "beautify-console-log";

const LOG_LEVEL_VALUES = ["silent", "error", "warn", "info", "debug"] as const;

export type LogLevel = (typeof LOG_LEVEL_VALUES)[number];

export const LOG_LEVELS = LOG_LEVEL_VALUES;

type ConsoleMethod = "log" | "info" | "warn" | "error";

const levelToMethods: Record<LogLevel, ConsoleMethod[]> = {
  silent: [],
  error: ["error"],
  warn: ["error", "warn"],
  info: ["error", "warn", "info"],
  debug: ["error", "warn", "info", "log"],
};

type BeautifyConsoleStatic = {
  new (): BeautifyConsoleInstance;
  getInstance: () => BeautifyConsoleInstance;
};

type BeautifyConsoleInstance = {
  log: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  reset: () => BeautifyConsoleInstance;
  open: (type?: ConsoleMethod) => BeautifyConsoleInstance;
  close: (type?: ConsoleMethod) => BeautifyConsoleInstance;
  config: (config: { type?: ConsoleMethod[]; title?: string }) => void;
};

const BeautifyConsoleModule = BeautifyConsoleImport as unknown as
  | BeautifyConsoleStatic
  | {
      default?: BeautifyConsoleStatic;
    };

const BeautifyConsole: BeautifyConsoleStatic = ((
  BeautifyConsoleModule as {
    default?: BeautifyConsoleStatic;
  }
)?.default ?? BeautifyConsoleModule) as BeautifyConsoleStatic;

const beautifiedConsole =
  typeof BeautifyConsole.getInstance === "function"
    ? BeautifyConsole.getInstance()
    : new BeautifyConsole();

const DEFAULT_LOG_TITLE = "CKBoost";

try {
  beautifiedConsole.config({ title: DEFAULT_LOG_TITLE });
} catch {
  // The underlying library throws if config is called before initialization in
  // exotic runtimes. Swallow and rely on later configuration.
}

let currentLevel: LogLevel = "debug";

const logLevelSet = new Set<LogLevel>(LOG_LEVEL_VALUES);

const applyLevel = (level: LogLevel) => {
  const allowedMethods = levelToMethods[level];

  beautifiedConsole.reset();

  if (allowedMethods.length === 0) {
    beautifiedConsole.close();
  } else {
    beautifiedConsole.config({
      type: allowedMethods,
      title: DEFAULT_LOG_TITLE,
    });
  }

  currentLevel = level;
};

applyLevel(currentLevel);

export const isLogLevel = (
  value: string | undefined | null
): value is LogLevel => {
  if (!value) {
    return false;
  }

  return logLevelSet.has(value.toLowerCase() as LogLevel);
};

export const parseLogLevel = (
  value: string | undefined | null,
  fallback: LogLevel = "debug"
): LogLevel => {
  const candidate = value?.toLowerCase();
  return isLogLevel(candidate) ? (candidate as LogLevel) : fallback;
};

export const setLogLevel = (level: LogLevel) => {
  applyLevel(level);
};

export const getLogLevel = () => currentLevel;

export type LogFunction = (...args: unknown[]) => void;

export type Logger = {
  log: LogFunction;
  info: LogFunction;
  warn: LogFunction;
  error: LogFunction;
};

type EmitOptions = {
  scope?: string;
};

const isNodeEnvironment =
  typeof process !== "undefined" && process.release?.name === "node";

const IGNORE_STACK_PATTERNS = ["/logging/index", "\\logging\\index"];

const normalizeFilePath = (absolutePath: string) => {
  if (!isNodeEnvironment) {
    return absolutePath;
  }

  try {
    const cwd = process.cwd();
    if (absolutePath.startsWith(cwd)) {
      const relative = absolutePath.slice(cwd.length + 1);
      if (relative.length > 0) {
        return relative;
      }
    }
  } catch {
    // ignore
  }

  return absolutePath;
};

const getCallSite = () => {
  if (!isNodeEnvironment) {
    return null;
  }

  const stack = new Error().stack;
  if (!stack) {
    return null;
  }

  const lines = stack.split("\n").slice(1);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (IGNORE_STACK_PATTERNS.some((pattern) => line.includes(pattern))) {
      continue;
    }

    let functionName: string | undefined;
    let filePath: string | undefined;
    let lineNumber: string | undefined;

    const withFunction = line.match(/^at\s+(.*?)\s+\((.*):(\d+):(\d+)\)$/);
    if (withFunction) {
      functionName = withFunction[1];
      filePath = withFunction[2];
      lineNumber = withFunction[3];
    } else {
      const withoutFunction = line.match(/^at\s+(.*):(\d+):(\d+)$/);
      if (withoutFunction) {
        filePath = withoutFunction[1];
        lineNumber = withoutFunction[2];
      }
    }

    if (!filePath || !lineNumber) {
      continue;
    }

    const normalizedPath = normalizeFilePath(filePath);

    return {
      file: normalizedPath,
      line: lineNumber,
      functionName:
        functionName && functionName !== "<anonymous>"
          ? functionName
          : undefined,
    };
  }

  return null;
};

const emit = (
  method: ConsoleMethod,
  args: unknown[],
  options: EmitOptions = {}
) => {
  const base = beautifiedConsole[method];
  if (typeof base !== "function") {
    return;
  }

  const parts: unknown[] = [];
  const callSite = getCallSite();

  if (callSite) {
    const segments = [
      `${callSite.file}:${callSite.line}`,
      ...(callSite.functionName ? [callSite.functionName] : []),
      ...(options.scope ? [options.scope] : []),
    ];
    parts.push(`[${segments.join(" ")}]`);
  } else if (options.scope) {
    parts.push(`[${options.scope}]`);
  }

  base.call(beautifiedConsole, ...parts, ...args);
};

export const logger: Logger = {
  log: (...args: unknown[]) => emit("log", args),
  info: (...args: unknown[]) => emit("info", args),
  warn: (...args: unknown[]) => emit("warn", args),
  error: (...args: unknown[]) => emit("error", args),
};

export const createScopedLogger = (scope: string): Logger => ({
  log: (...args: unknown[]) => emit("log", args, { scope }),
  info: (...args: unknown[]) => emit("info", args, { scope }),
  warn: (...args: unknown[]) => emit("warn", args, { scope }),
  error: (...args: unknown[]) => emit("error", args, { scope }),
});

export const log = logger;

const now = () =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();

const formatDuration = (start: number | undefined) =>
  start !== undefined ? `${(now() - start).toFixed(2)}ms` : "unknown";

export type TimerControls = {
  time: (label: string) => void;
  timeEnd: (label: string) => void;
};

export const createTimer = (target: Logger = logger): TimerControls => {
  const timers = new Map<string, number>();

  return {
    time: (label: string) => {
      timers.set(label, now());
      target.log(`[Timer Start] ${label}`);
    },
    timeEnd: (label: string) => {
      const start = timers.get(label);
      timers.delete(label);
      target.log(`[Timer End] ${label} (${formatDuration(start)})`);
    },
  };
};

export const timer = createTimer();

export const formatDateConsistent = (dateString: string | Date): string => {
  const date =
    typeof dateString === "string" ? new Date(dateString) : dateString;

  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  const year = date.getFullYear();

  return `${month}/${day}/${year}`;
};
