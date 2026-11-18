// Flexible-date search: the lowest fare for every departure date in a rolling
// window ("any time in the next six months"), instead of one fixed itinerary.

import { flexScanCost, type FlexDay, type FlexMonth, type FlexQuery, type FlexResult } from '@shared/types';
import { HttpError, type Ctx } from '../context';
import { airportMap } from '../data/airports';
import { addDays, toDateString } from '../lib/dates';
import { quantile } from '../lib/stats';
import type { CalendarQuery } from '../providers/types';
import { isFresh, readCache, writeCache, type SearchOptions } from './search';
import { assertBudget, recordUsage } from './usage';

interface StoredCalendar {
  fetchedAt: string;
  days: FlexDay[];
}

export interface CalendarScan {
  /** The dates searched, which stop where the provider's calendar does. */
  range: { start: string; end: string };
  /** One entry per departure date that has a fare, in date order. */
  days: FlexDay[];
  fetchedAt: string;
  cached: boolean;
  searchesUsed: number;
}

/** The dates a window covers today: from tomorrow, so nothing in it has already left. */
export function flexRange(ctx: Ctx, windowDays: number): { start: string; end: string } {
  const today = toDateString(ctx.now());
  return { start: addDays(today, 1), end: addDays(today, windowDays) };
}

function cacheKey(providerId: string, q: CalendarQuery): string {
  return ['cal', providerId, q.origin, q.destination, q.start, q.end, q.tripDays ?? 'ow', q.adults, q.cabin, q.currency, q.maxStops ?? 'any'].join('|');
}

// Identical requests that arrive while one is running share its result.
const inflight = new Map<string, Promise<StoredCalendar>>();

/**
 * Prices every departure date in the window with one provider request. A
 * window longer than the provider's calendar reaches is cut down to it: asking
 * for more returns nothing at all rather than the part that exists.
 */
export async function runCalendar(ctx: Ctx, flex: FlexQuery, options: Pick<SearchOptions, 'force' | 'maxAgeMinutes'> = {}): Promise<CalendarScan> {
  const { provider } = ctx;
  const reach = provider.info.calendarMaxDays;
  if (!provider.calendar || !reach) throw new HttpError(501, 'This data source cannot search flexible dates.', 'flex_unsupported');

  const range = flexRange(ctx, Math.min(flex.windowDays, reach));
  const query: CalendarQuery = {
    origin: flex.origin,
    destination: flex.destination,
    start: range.start,
    end: range.end,
    tripDays: flex.tripDays,
    adults: flex.adults,
    cabin: flex.cabin,
    currency: flex.currency,
    maxStops: flex.maxStops,
  };
  const key = cacheKey(provider.info.id, query);
  const inRange = (stored: StoredCalendar) => stored.days.filter((d) => d.departDate >= range.start && d.departDate <= range.end && d.price > 0);

  const hit = options.force ? null : readCache<StoredCalendar>(ctx, key);
  if (hit && isFresh(ctx, hit, options.maxAgeMinutes ?? ctx.config.cacheMinutes)) {
    return { range, days: inRange(hit), fetchedAt: hit.fetchedAt, cached: true, searchesUsed: 0 };
  }
  const running = inflight.get(key);
  if (running) {
    const shared = await running;
    return { range, days: inRange(shared), fetchedAt: shared.fetchedAt, cached: true, searchesUsed: 0 };
  }

  assertBudget(ctx, provider.info.costPerSearch);
  let searchesUsed = 0;
  const promise = (async () => {
    const result = await (provider.calendar as NonNullable<typeof provider.calendar>)(query, ctx.now());
    recordUsage(ctx, result.cost);
    searchesUsed = result.cost;
    const fresh: StoredCalendar = { fetchedAt: ctx.now().toISOString(), days: [...result.days].sort((a, b) => a.departDate.localeCompare(b.departDate)) };
    writeCache(ctx, key, fresh);
    return fresh;
  })();
  inflight.set(key, promise);
  try {
    const fresh = await promise;
    return { range, days: inRange(fresh), fetchedAt: fresh.fetchedAt, cached: false, searchesUsed };
  } finally {
    inflight.delete(key);
  }
}

/** The lowest-priced day; the earliest one when several tie. */
export function cheapestDay(days: readonly FlexDay[]): FlexDay | null {
  let best: FlexDay | null = null;
  for (const day of days) if (!best || day.price < best.price) best = day;
  return best;
}

export interface MonthMove {
  /** YYYY-MM */
  month: string;
  current: FlexDay;
  previous: FlexDay;
}

/**
 * How each month's cheapest fare moved between two scans. Only dates present in
 * both are compared: the window rolls forward a day at a time, and a date that
 * has just entered it is not a price change.
 */
export function monthMoves(current: readonly FlexDay[], previous: readonly FlexDay[]): MonthMove[] {
  const before = new Map(previous.map((d) => [d.departDate, d]));
  const moves = new Map<string, MonthMove>();
  for (const day of current) {
    const was = before.get(day.departDate);
    if (!was) continue;
    const month = day.departDate.slice(0, 7);
    const move = moves.get(month);
    if (!move) {
      moves.set(month, { month, current: day, previous: was });
      continue;
    }
    if (day.price < move.current.price) move.current = day;
    if (was.price < move.previous.price) move.previous = was;
  }
  return [...moves.values()];
}

export function summarizeMonths(days: readonly FlexDay[], previous: readonly FlexDay[] | null = null): FlexMonth[] {
  const groups = new Map<string, FlexDay[]>();
  for (const day of days) {
    const month = day.departDate.slice(0, 7);
    const group = groups.get(month);
    if (group) group.push(day);
    else groups.set(month, [day]);
  }
  const moves = new Map((previous ? monthMoves(days, previous) : []).map((m) => [m.month, m]));
  return [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, group]) => {
      const move = moves.get(month);
      return {
        month,
        cheapest: cheapestDay(group) as FlexDay,
        days: group.length,
        median: Math.round(quantile(group.map((d) => d.price), 0.5) as number),
        change: move ? move.current.price - move.previous.price : null,
      };
    });
}

/** Provider searches one scan of a flexible trip costs. */
export function flexScanSearches(ctx: Ctx): number {
  return flexScanCost(ctx.provider.info);
}

export async function searchFlex(ctx: Ctx, flex: FlexQuery, refresh = false): Promise<FlexResult> {
  const scan = await runCalendar(ctx, flex, { force: refresh });
  return {
    query: flex,
    provider: ctx.provider.info,
    fetchedAt: scan.fetchedAt,
    cached: scan.cached,
    range: scan.range,
    days: scan.days,
    cheapest: cheapestDay(scan.days),
    months: summarizeMonths(scan.days),
    searchesUsed: scan.searchesUsed,
    airports: airportMap([flex.origin, flex.destination]),
  };
}
