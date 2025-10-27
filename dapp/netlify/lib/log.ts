import {
  createScopedLogger,
  logger,
  parseLogLevel,
  setLogLevel,
  type LogLevel,
} from "ssri-ckboost";

const defaultLogLevel: LogLevel =
  process.env.NODE_ENV === "production" ? "error" : "debug";

const configuredLogLevel = parseLogLevel(
  process.env.NETLIFY_LOG_LEVEL ??
    process.env.CKBOOST_LOG_LEVEL ??
    process.env.LOG_LEVEL,
  defaultLogLevel
);

setLogLevel(configuredLogLevel);

export const log = logger;

export const createLogger = (scope: string) => createScopedLogger(scope);

export { setLogLevel, configuredLogLevel as currentLogLevel };

export type { LogLevel };
