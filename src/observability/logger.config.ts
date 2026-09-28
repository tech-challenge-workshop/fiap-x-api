import { randomUUID } from 'node:crypto';
import type { Options as PinoHttpOptions } from 'pino-http';
import { CorrelationContext, parseCorrelationId } from './correlation-context';

const ACCESS_LOG_EXCLUDED_PATHS = ['/health', '/health/live', '/metrics'];

// SPEC_DEVIATION: design.md lists only the `*.`-prefixed paths. fast-redact
// wildcards require a parent key, so a root-level `{ ownerEmail }` (the design
// risk table's own example) would survive redaction. The bare keys are added so
// the OBS-06 outcome (an email-like value under any email/ownerEmail key never
// survives) holds at the root and one nesting level deep.
// Reason: the spec-defined outcome outranks the design's literal path list.
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'email',
  'ownerEmail',
  'zipStorageKey',
  'sourceStorageKey',
  '*.email',
  '*.ownerEmail',
  '*.zipStorageKey',
  '*.sourceStorageKey',
];

// SPEC_DEVIATION: design.md routes `service` through pino-http `customProps`,
// but customProps only reaches the request-scoped child loggers, so lines from
// the root instance (bootstrap, non-request flows) carry no `service` and the
// OBS-02 outcome ("any log line ... carrying at least ... service") fails.
// `service` moved into the root mixin, which applies to every line; customProps
// was dropped as it would duplicate the key on request lines.
// Reason: the spec-defined outcome outranks the design's literal config split.
const SERVICE_NAME = 'fiap-x-api';

export interface RootLoggerConfig {
  pinoHttp: PinoHttpOptions;
}

export function buildRootLoggerConfig(
  context: CorrelationContext,
): RootLoggerConfig {
  return {
    pinoHttp: {
      level: process.env.LOG_LEVEL ?? 'info',
      timestamp: () => `,"timestamp":${Date.now()}`,
      mixin: () => {
        const correlationId = context.getCorrelationId();
        return correlationId === undefined
          ? { service: SERVICE_NAME }
          : { service: SERVICE_NAME, correlationId };
      },
      redact: { paths: REDACT_PATHS, remove: true },
      genReqId: (req) =>
        parseCorrelationId(req.headers['x-correlation-id']) ?? randomUUID(),
      autoLogging: {
        ignore: (req) => {
          const url = req.url;
          return url !== undefined && ACCESS_LOG_EXCLUDED_PATHS.includes(url);
        },
      },
    },
  };
}
