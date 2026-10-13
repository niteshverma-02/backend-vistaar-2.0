import type { IncomingMessage, ServerResponse } from 'node:http';

import type { Options } from 'pino-http';

/** Probes hit these every few seconds; a log line each would drown the real traffic. */
const QUIET_PATHS = ['/api/v2/health'];

/**
 * One short line per request: id, method, URL, status and time. The default
 * serializers print every request and response header (~1.3 KB a line) —
 * load tests showed that alone cost ~2–3× throughput.
 */
export const HTTP_LOG_OPTIONS: Pick<
  Options,
  'serializers' | 'autoLogging' | 'customLogLevel'
> = {
  serializers: {
    req: (req: IncomingMessage & { id?: unknown }) => ({
      id: req.id,
      method: req.method,
      url: req.url,
    }),
    res: (res: ServerResponse) => ({ statusCode: res.statusCode }),
  },
  autoLogging: {
    ignore: (req) => QUIET_PATHS.some((p) => req.url?.startsWith(p) ?? false),
  },
  customLogLevel: (_req, res, error) => {
    if (error || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
};
