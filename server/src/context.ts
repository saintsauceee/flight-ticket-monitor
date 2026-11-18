import type { Config } from './config';
import type { DB } from './db';
import type { FlightProvider } from './providers/types';

/** Everything a service needs; passed explicitly so tests can swap any part. */
export interface Ctx {
  db: DB;
  provider: FlightProvider;
  config: Config;
  now: () => Date;
}

/** An error with an HTTP status that is safe to show to the user. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code = 'error',
  ) {
    super(message);
    this.name = 'HttpError';
  }
}
