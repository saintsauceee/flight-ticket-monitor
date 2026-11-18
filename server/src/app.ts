import { readFileSync } from 'node:fs';
import path from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';
import { CABINS, FLEX_DEFAULT_WINDOW_DAYS, FLEX_MAX_TRIP_DAYS, FLEX_MAX_WINDOW_DAYS, type ApiError, type Meta } from '@shared/types';
import { HttpError, type Ctx } from './context';
import { searchAirports } from './data/airports';
import { addDays, isValidDate, toDateString } from './lib/dates';
import { ProviderError } from './providers/types';
import { listAlerts, markAlertsRead, unreadAlertCount } from './services/alerts';
import { searchFlex } from './services/flex';
import { loadOfferDetails, scanCalendar, searchFlights } from './services/search';
import { getUsage } from './services/usage';
import {
  checkWatch,
  createWatch,
  deleteWatch,
  getWatchDetail,
  listWatches,
  projectedMonthlySearches,
  updateWatch,
} from './services/watches';

const emptyToNull = (v: unknown) => (v === '' || v === undefined || v === 'any' ? null : v);
const iata = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Use a 3-letter airport code');
const date = z.string().trim().refine(isValidDate, 'Use a date in YYYY-MM-DD format');

const tripFields = {
  origin: iata,
  destination: iata,
  adults: z.coerce.number().int().min(1).max(9).default(1),
  cabin: z.enum(CABINS).default('economy'),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Use a 3-letter currency code').default('USD'),
  maxStops: z.preprocess(emptyToNull, z.coerce.number().int().min(0).max(2).nullable()).default(null),
};
const differentAirports = (q: { origin: string; destination: string }, issue: z.RefinementCtx) => {
  if (q.origin === q.destination) issue.addIssue({ code: 'custom', path: ['destination'], message: 'Origin and destination must differ' });
};

const querySchema = z
  .object({
    ...tripFields,
    departDate: date,
    returnDate: z.preprocess(emptyToNull, date.nullable()).default(null),
  })
  .superRefine((q, issue) => {
    differentAirports(q, issue);
    if (q.returnDate && q.returnDate < q.departDate) {
      issue.addIssue({ code: 'custom', path: ['returnDate'], message: 'The return date is before the departure date' });
    }
  });

/** A trip with no fixed dates: any departure in the next `windowDays` days. */
const flexSchema = z
  .object({
    ...tripFields,
    tripDays: z.preprocess(emptyToNull, z.coerce.number().int().min(1).max(FLEX_MAX_TRIP_DAYS).nullable()).default(null),
    windowDays: z.coerce.number().int().min(7).max(FLEX_MAX_WINDOW_DAYS).default(FLEX_DEFAULT_WINDOW_DAYS),
  })
  .superRefine(differentAirports);

const interval = z.number().min(1).max(24 * 14);
const price = z.number().positive().max(10_000_000).nullable();
const createWatchSchema = z
  .object({ query: querySchema.optional(), flex: flexSchema.optional(), targetPrice: price.optional(), checkIntervalHours: interval.optional() })
  .refine((input) => (input.query == null) !== (input.flex == null), 'Give either a trip with dates (query) or a flexible trip (flex)');
const updateWatchSchema = z.object({ targetPrice: price.optional(), active: z.boolean().optional(), checkIntervalHours: interval.optional() });
const detailsSchema = z.object({ query: querySchema, offerId: z.string().min(1).max(64) });
const readSchema = z.object({ ids: z.array(z.number().int()).max(500).optional(), watchId: z.number().int().optional() });

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function watchId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(404, 'Tracked route not found', 'not_found');
  return id;
}

export function createApp(ctx: Ctx): Hono {
  const app = new Hono();

  const body = async (c: { req: { json(): Promise<unknown> } }): Promise<unknown> => {
    try {
      return await c.req.json();
    } catch {
      throw new HttpError(400, 'The request body is not valid JSON', 'invalid_json');
    }
  };

  /** Search queries may not start in the past (one day of slack for time zones). */
  const parseQuery = (input: unknown) => {
    const query = querySchema.parse(input);
    if (query.departDate < addDays(toDateString(ctx.now()), -1)) throw new HttpError(400, 'The departure date is in the past', 'invalid_date');
    return query;
  };

  // The API has no login and some calls cost provider searches, so it only
  // answers the app itself: not other websites open in the same browser.
  app.use('/api/*', async (c, next) => {
    const host = (c.req.header('host') ?? '').toLowerCase();
    const hostname = host.replace(/:\d+$/, '');
    // Bound to this machine only: a request addressed to any other name is DNS rebinding.
    if (LOOPBACK.has(ctx.config.host) && hostname && !LOOPBACK.has(hostname)) {
      throw new HttpError(403, 'This server only answers requests addressed to localhost', 'forbidden');
    }
    if (c.req.header('sec-fetch-site') === 'cross-site') {
      throw new HttpError(403, 'Requests from other sites are not allowed', 'forbidden');
    }
    const origin = c.req.header('origin');
    if (origin && !['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
      let originHost = '';
      try {
        originHost = new URL(origin).host.toLowerCase();
      } catch {
        // "null" or malformed origins never match
      }
      if (originHost !== host) throw new HttpError(403, 'Requests from other sites are not allowed', 'forbidden');
    }
    await next();
  });

  app.get('/api/health', (c) => c.json({ ok: true }));

  app.get('/api/meta', (c) => {
    const meta: Meta = {
      provider: ctx.provider.info,
      usage: getUsage(ctx),
      defaultCheckIntervalHours: ctx.config.checkIntervalHours,
      projectedMonthlySearches: projectedMonthlySearches(ctx),
    };
    return c.json(meta);
  });

  app.get('/api/airports', (c) => {
    const limit = Math.min(20, Math.max(1, Number(c.req.query('limit')) || 8));
    return c.json(searchAirports(c.req.query('q') ?? '', limit));
  });

  app.get('/api/search', async (c) => {
    const query = parseQuery(c.req.query());
    return c.json(await searchFlights(ctx, query, c.req.query('refresh') === '1'));
  });

  // Lowest fare for every departure date in the coming months.
  app.get('/api/flex', async (c) => {
    const flex = flexSchema.parse(c.req.query());
    return c.json(await searchFlex(ctx, flex, c.req.query('refresh') === '1'));
  });

  app.get('/api/calendar', async (c) => {
    const query = parseQuery(c.req.query());
    const window = Math.min(7, Math.max(1, Number(c.req.query('window')) || 3));
    return c.json(await scanCalendar(ctx, query, window, c.req.query('cachedOnly') === '1'));
  });

  app.post('/api/offers/details', async (c) => {
    const input = detailsSchema.parse(await body(c));
    return c.json(await loadOfferDetails(ctx, input.query, input.offerId));
  });

  app.get('/api/watches', (c) => c.json(listWatches(ctx)));

  app.post('/api/watches', async (c) => {
    const input = createWatchSchema.parse(await body(c));
    if (input.query) parseQuery(input.query);
    const { watch, created } = await createWatch(ctx, input);
    return c.json(watch, created ? 201 : 200);
  });

  app.get('/api/watches/:id', (c) => c.json(getWatchDetail(ctx, watchId(c.req.param('id')))));

  app.patch('/api/watches/:id', async (c) => {
    const patch = updateWatchSchema.parse(await body(c));
    return c.json(updateWatch(ctx, watchId(c.req.param('id')), patch));
  });

  app.delete('/api/watches/:id', (c) => {
    deleteWatch(ctx, watchId(c.req.param('id')));
    return c.body(null, 204);
  });

  app.post('/api/watches/:id/check', async (c) => {
    const id = watchId(c.req.param('id'));
    await checkWatch(ctx, id, 'manual');
    return c.json(getWatchDetail(ctx, id));
  });

  app.get('/api/alerts', (c) => c.json({ alerts: listAlerts(ctx, { limit: 200 }), unread: unreadAlertCount(ctx) }));

  app.post('/api/alerts/read', async (c) => {
    const target = readSchema.parse(await body(c));
    return c.json({ updated: markAlertsRead(ctx, target), unread: unreadAlertCount(ctx) });
  });

  app.all('/api/*', () => {
    throw new HttpError(404, 'Not found', 'not_found');
  });

  // In production the API also serves the built web app.
  const indexFile = path.join(ctx.config.webDist, 'index.html');
  if (ctx.config.serveWeb) {
    app.use('/*', serveStatic({ root: path.relative(process.cwd(), ctx.config.webDist) || '.' }));
    app.get('*', (c) => c.html(readFileSync(indexFile, 'utf8')));
  }

  app.onError((err, c) => {
    const send = (status: number, payload: ApiError) => c.json(payload, status as ContentfulStatusCode);
    if (err instanceof HttpError || err instanceof ProviderError) return send(err.status, { error: err.message, code: err.code });
    if (err instanceof z.ZodError) {
      const first = err.issues[0];
      const field = first?.path.join('.');
      return send(400, { error: field ? `${field}: ${first?.message}` : (first?.message ?? 'Invalid request'), code: 'invalid_request' });
    }
    console.error(err);
    return send(500, { error: 'Something went wrong on the server', code: 'internal' });
  });

  return app;
}
