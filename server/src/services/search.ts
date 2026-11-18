import type { CalendarDay, CalendarResult, FlightOffer, SearchQuery, SearchResult } from '@shared/types';
import { HttpError, type Ctx } from '../context';
import { airportMap } from '../data/airports';
import { addDays, toDateString } from '../lib/dates';
import { publicOffer, type ProviderSearchResult } from '../providers/types';
import { assertBudget, recordUsage } from './usage';

export interface StoredSearch {
  query: SearchQuery;
  fetchedAt: string;
  result: ProviderSearchResult;
}

const CACHE_RETENTION_MS = 3 * 86_400_000;

export function cacheKey(providerId: string, q: SearchQuery): string {
  return [providerId, q.origin, q.destination, q.departDate, q.returnDate ?? '', q.adults, q.cabin, q.currency, q.maxStops ?? 'any'].join('|');
}

export function readCache<T extends { fetchedAt: string } = StoredSearch>(ctx: Ctx, key: string): T | null {
  const row = ctx.db.prepare('SELECT result_json FROM search_cache WHERE key = ?').get(key) as { result_json: string } | undefined;
  return row ? (JSON.parse(row.result_json) as T) : null;
}

export function writeCache(ctx: Ctx, key: string, stored: { fetchedAt: string }): void {
  ctx.db
    .prepare(
      `INSERT INTO search_cache (key, fetched_at, result_json) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET fetched_at = excluded.fetched_at, result_json = excluded.result_json`,
    )
    .run(key, stored.fetchedAt, JSON.stringify(stored));
  ctx.db.prepare('DELETE FROM search_cache WHERE fetched_at < ?').run(new Date(ctx.now().getTime() - CACHE_RETENTION_MS).toISOString());
}

export function isFresh(ctx: Ctx, stored: { fetchedAt: string }, maxAgeMinutes: number): boolean {
  return ctx.now().getTime() - new Date(stored.fetchedAt).getTime() <= maxAgeMinutes * 60_000;
}

// Identical searches that arrive while one is already running share its result
// instead of spending a second provider search.
const inflight = new Map<string, Promise<StoredSearch>>();

export interface SearchOptions {
  /** Accept a cached result up to this old. Defaults to the configured cache time. */
  maxAgeMinutes?: number;
  /** Never call the provider; return null when nothing fresh is cached. */
  cachedOnly?: boolean;
  /** Skip the cache and fetch fresh fares. */
  force?: boolean;
}

export async function runSearch(ctx: Ctx, query: SearchQuery, options: SearchOptions & { cachedOnly: true }): Promise<{ stored: StoredSearch; cached: boolean } | null>;
export async function runSearch(ctx: Ctx, query: SearchQuery, options?: SearchOptions): Promise<{ stored: StoredSearch; cached: boolean }>;
export async function runSearch(ctx: Ctx, query: SearchQuery, options: SearchOptions = {}): Promise<{ stored: StoredSearch; cached: boolean } | null> {
  const key = cacheKey(ctx.provider.info.id, query);
  const maxAge = options.maxAgeMinutes ?? ctx.config.cacheMinutes;

  const hit = options.force ? null : readCache(ctx, key);
  if (hit && isFresh(ctx, hit, maxAge)) return { stored: hit, cached: true };
  if (options.cachedOnly) return null;

  const running = inflight.get(key);
  if (running) return { stored: await running, cached: true };

  assertBudget(ctx, ctx.provider.info.costPerSearch);
  const promise = (async () => {
    const result = await ctx.provider.search(query, ctx.now());
    recordUsage(ctx, result.cost);
    const stored: StoredSearch = { query, fetchedAt: ctx.now().toISOString(), result };
    writeCache(ctx, key, stored);
    return stored;
  })();
  inflight.set(key, promise);
  try {
    return { stored: await promise, cached: false };
  } finally {
    inflight.delete(key);
  }
}

/** A Google Flights search for the same trip: a handy cross-check, and where the user would book. */
export function googleFlightsUrl(q: SearchQuery): string {
  const text = `Flights from ${q.origin} to ${q.destination} on ${q.departDate}${q.returnDate ? ` through ${q.returnDate}` : ' one way'}`;
  return `https://www.google.com/travel/flights?q=${encodeURIComponent(text)}&curr=${encodeURIComponent(q.currency)}`;
}

export function referencedAirports(query: SearchQuery, offers: readonly FlightOffer[]) {
  const codes = new Set<string>([query.origin, query.destination]);
  for (const offer of offers) {
    for (const slice of offer.slices) {
      for (const segment of slice.segments) {
        codes.add(segment.from);
        codes.add(segment.to);
      }
    }
  }
  return airportMap(codes);
}

export function toSearchResult(ctx: Ctx, stored: StoredSearch, cached: boolean): SearchResult {
  const offers = stored.result.offers.map(publicOffer);
  return {
    query: stored.query,
    provider: ctx.provider.info,
    fetchedAt: stored.fetchedAt,
    cached,
    offers,
    insights: stored.result.insights
      ? { ...stored.result.insights, history: stored.result.history.map(({ t, price }) => ({ t, price })) }
      : null,
    airports: referencedAirports(stored.query, offers),
    externalUrl: stored.result.externalUrl ?? googleFlightsUrl(stored.query),
  };
}

export async function searchFlights(ctx: Ctx, query: SearchQuery, refresh = false): Promise<SearchResult> {
  const { stored, cached } = await runSearch(ctx, query, { force: refresh });
  return toSearchResult(ctx, stored, cached);
}

/** Loads fare rules and bag fees for one offer of a cached search and stores them with it. */
export async function loadOfferDetails(ctx: Ctx, query: SearchQuery, offerId: string): Promise<FlightOffer> {
  const key = cacheKey(ctx.provider.info.id, query);
  const stored = readCache(ctx, key);
  const offer = stored?.result.offers.find((o) => o.id === offerId);
  if (!stored || !offer) throw new HttpError(404, 'That flight is no longer in the latest results. Search again to refresh.', 'offer_not_found');
  if (offer.details !== 'available' || !ctx.provider.loadDetails) return publicOffer(offer);

  assertBudget(ctx, offer.detailsCost);
  const { offer: detailed, cost } = await ctx.provider.loadDetails(query, offer);
  recordUsage(ctx, cost);

  // Re-read before writing: another request may have updated the entry meanwhile.
  const latest = readCache(ctx, key) ?? stored;
  latest.result.offers = latest.result.offers.map((o) => (o.id === offerId ? detailed : o));
  writeCache(ctx, key, latest);
  return publicOffer(detailed);
}

function cheapestDay(stored: StoredSearch): Pick<CalendarDay, 'minPrice' | 'airline'> {
  const best = stored.result.offers.reduce<FlightOffer | null>((min, o) => (!min || o.price < min.price ? o : min), null);
  return { minPrice: best?.price ?? null, airline: best?.airline ?? null };
}

/**
 * Cheapest fare for each departure date around the requested one. Round trips
 * keep their length: the return date shifts together with the departure.
 */
export async function scanCalendar(ctx: Ctx, query: SearchQuery, window: number, cachedOnly: boolean): Promise<CalendarResult> {
  const today = toDateString(ctx.now());
  const dates: { departDate: string; returnDate: string | null }[] = [];
  for (let offset = -window; offset <= window; offset++) {
    const departDate = addDays(query.departDate, offset);
    if (departDate < today) continue;
    dates.push({ departDate, returnDate: query.returnDate ? addDays(query.returnDate, offset) : null });
  }

  const days: CalendarDay[] = [];
  let searchesUsed = 0;
  let notice: string | null = null;

  for (const date of dates) {
    const dayQuery = { ...query, ...date };
    const blank: CalendarDay = { ...date, minPrice: null, airline: null, fetched: false };
    if (cachedOnly || notice) {
      const hit = await runSearch(ctx, dayQuery, { cachedOnly: true });
      days.push(hit ? { ...date, ...cheapestDay(hit.stored), fetched: true } : blank);
      continue;
    }
    try {
      const { stored, cached } = await runSearch(ctx, dayQuery);
      if (!cached) searchesUsed += stored.result.cost;
      days.push({ ...date, ...cheapestDay(stored), fetched: true });
    } catch (err) {
      // Keep what was scanned so far; report why the rest is missing.
      notice = err instanceof Error ? err.message : 'The scan stopped early.';
      days.push(blank);
    }
  }
  return { days, currency: query.currency, searchesUsed, notice };
}
