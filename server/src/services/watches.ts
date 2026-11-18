import { FLEX_DEFAULT_WINDOW_DAYS } from '@shared/types';
import type {
  AirlineRef,
  AirlineSeries,
  CabinClass,
  CreateWatchInput,
  FlexDay,
  FlexQuery,
  FlightOffer,
  HistoryPoint,
  MonthSeries,
  PriceLevel,
  SearchQuery,
  UpdateWatchInput,
  Watch,
  WatchCalendar,
  WatchDetail,
  WatchKind,
  WatchSummary,
} from '@shared/types';
import { HttpError, type Ctx } from '../context';
import { getAirport } from '../data/airports';
import { daysBetween, toDateString } from '../lib/dates';
import { mean } from '../lib/stats';
import { publicOffer } from '../providers/types';
import { evaluateAlerts, evaluateFlexAlerts, insertAlerts, listAlerts } from './alerts';
import { flexScanSearches, runCalendar, summarizeMonths, type CalendarScan } from './flex';
import { computeStats, computeVerdict } from './insights';
import { googleFlightsUrl, referencedAirports, runSearch, type StoredSearch } from './search';

const HOUR_MS = 3_600_000;
/** Provider history points closer than this to an existing observation are not back-filled. */
const BACKFILL_GAP_MS = 12 * HOUR_MS;
const SPARK_POINTS = 60;

interface WatchRow {
  id: number;
  kind: WatchKind;
  origin: string;
  destination: string;
  /** '' for a flexible watch. */
  depart_date: string;
  return_date: string | null;
  trip_days: number | null;
  window_days: number | null;
  adults: number;
  cabin: CabinClass;
  currency: string;
  max_stops: number | null;
  target_price: number | null;
  active: number;
  check_interval_hours: number;
  created_at: string;
  last_checked_at: string | null;
  next_check_at: string | null;
  last_error: string | null;
  latest_json: string | null;
}

interface SnapshotRow {
  id: number;
  checked_at: string;
  source: 'check' | 'history';
  min_price: number | null;
  level: PriceLevel | null;
  typical_low: number | null;
  typical_high: number | null;
}

interface LatestOffers {
  offers: FlightOffer[];
  fetchedAt: string;
  externalUrl: string | null;
}

export type CheckMode = 'initial' | 'scheduled' | 'manual';

/** The trip a row tracks. A flexible watch has no dates of its own: it shows the cheapest ones found (`best`). */
function rowToQuery(row: WatchRow, best: FlexDay | null = null): SearchQuery {
  const flexible = row.kind === 'flex';
  return {
    origin: row.origin,
    destination: row.destination,
    departDate: flexible ? (best?.departDate ?? '') : row.depart_date,
    returnDate: flexible ? (best?.returnDate ?? null) : row.return_date,
    adults: row.adults,
    cabin: row.cabin,
    currency: row.currency,
    maxStops: row.max_stops,
  };
}

function rowToFlex(row: WatchRow): FlexQuery {
  return {
    origin: row.origin,
    destination: row.destination,
    tripDays: row.trip_days,
    windowDays: row.window_days ?? FLEX_DEFAULT_WINDOW_DAYS,
    adults: row.adults,
    cabin: row.cabin,
    currency: row.currency,
    maxStops: row.max_stops,
  };
}

function rowToWatch(row: WatchRow, best: FlexDay | null): Watch {
  return {
    id: row.id,
    kind: row.kind,
    query: rowToQuery(row, best),
    flex: row.kind === 'flex' ? { tripDays: row.trip_days, windowDays: row.window_days ?? FLEX_DEFAULT_WINDOW_DAYS } : null,
    targetPrice: row.target_price,
    active: row.active === 1,
    checkIntervalHours: row.check_interval_hours,
    createdAt: row.created_at,
    lastCheckedAt: row.last_checked_at,
    nextCheckAt: row.next_check_at,
    lastError: row.last_error,
  };
}

export function moneyFormatter(currency: string): (amount: number) => string {
  try {
    const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 });
    return (amount) => fmt.format(amount);
  } catch {
    return (amount) => `${Math.round(amount)} ${currency}`;
  }
}

function getRow(ctx: Ctx, id: number): WatchRow {
  const row = ctx.db.prepare('SELECT * FROM watches WHERE id = ?').get(id) as WatchRow | undefined;
  if (!row) throw new HttpError(404, 'Tracked route not found', 'not_found');
  return row;
}

function snapshotsFor(ctx: Ctx, watchId: number): SnapshotRow[] {
  return ctx.db
    .prepare('SELECT id, checked_at, source, min_price, level, typical_low, typical_high FROM snapshots WHERE watch_id = ? ORDER BY checked_at, id')
    .all(watchId) as SnapshotRow[];
}

/** Fares per departure date stored with one scan of a flexible watch. */
function calendarOf(ctx: Ctx, snapshotId: number): FlexDay[] {
  return ctx.db
    .prepare('SELECT depart_date AS departDate, return_date AS returnDate, price FROM calendar_prices WHERE snapshot_id = ? ORDER BY depart_date')
    .all(snapshotId) as FlexDay[];
}

function cheapestOf(ctx: Ctx, snapshotId: number): FlexDay | null {
  const row = ctx.db
    .prepare('SELECT depart_date AS departDate, return_date AS returnDate, price FROM calendar_prices WHERE snapshot_id = ? ORDER BY price, depart_date LIMIT 1')
    .get(snapshotId) as FlexDay | undefined;
  return row ?? null;
}

const isExpired = (ctx: Ctx, row: WatchRow) => row.kind === 'fixed' && row.depart_date < toDateString(ctx.now());

function summarize(ctx: Ctx, row: WatchRow, snapshots: SnapshotRow[] = snapshotsFor(ctx, row.id)): WatchSummary {
  const priced = snapshots.filter((s): s is SnapshotRow & { min_price: number } => s.min_price != null);
  const latestCheck = snapshots.findLast((s) => s.source === 'check') ?? null;
  const previous = latestCheck ? priced.findLast((s) => s.checked_at < latestCheck.checked_at) : undefined;
  const prices = priced.map((s) => s.min_price);

  const cheapest = latestCheck
    ? (ctx.db
        .prepare('SELECT airline_code, airline_name, airline_logo FROM snapshot_airlines WHERE snapshot_id = ? ORDER BY min_price LIMIT 1')
        .get(latestCheck.id) as { airline_code: string; airline_name: string; airline_logo: string | null } | undefined)
    : undefined;
  const unread = ctx.db.prepare('SELECT COUNT(*) AS n FROM alerts WHERE watch_id = ? AND read_at IS NULL').get(row.id) as { n: number };
  const best = row.kind === 'flex' && latestCheck ? cheapestOf(ctx, latestCheck.id) : null;

  return {
    ...rowToWatch(row, best),
    originAirport: getAirport(row.origin),
    destinationAirport: getAirport(row.destination),
    expired: isExpired(ctx, row),
    currentPrice: latestCheck?.min_price ?? null,
    previousPrice: previous?.min_price ?? null,
    lowestPrice: prices.length ? Math.min(...prices) : null,
    highestPrice: prices.length ? Math.max(...prices) : null,
    averagePrice: prices.length ? Math.round(mean(prices) as number) : null,
    level: latestCheck?.level ?? null,
    cheapestAirline: cheapest ? { code: cheapest.airline_code, name: cheapest.airline_name, logoUrl: cheapest.airline_logo } : null,
    observations: priced.length,
    spark: priced.slice(-SPARK_POINTS).map((s) => ({ t: s.checked_at, price: s.min_price })),
    unreadAlerts: unread.n,
  };
}

export function listWatches(ctx: Ctx): WatchSummary[] {
  // Flexible trips first (their depart_date is ''), then by departure.
  const rows = ctx.db.prepare('SELECT * FROM watches ORDER BY depart_date, id').all() as WatchRow[];
  return rows.map((row) => summarize(ctx, row));
}

export function getWatchSummary(ctx: Ctx, id: number): WatchSummary {
  return summarize(ctx, getRow(ctx, id));
}

/** The latest scan of a flexible watch, with each month compared against the scan before it. */
function calendarDetail(ctx: Ctx, row: WatchRow, snapshots: SnapshotRow[]): WatchCalendar | null {
  const checks = snapshots.filter((s) => s.source === 'check' && s.min_price != null);
  const latest = checks[checks.length - 1];
  if (!latest) return null;
  const days = calendarOf(ctx, latest.id);
  const first = days[0];
  const last = days[days.length - 1];
  if (!first || !last) return null;
  const before = checks[checks.length - 2];

  const quotes = ctx.db
    .prepare(
      `SELECT s.id AS snapshot_id, s.checked_at AS t, substr(c.depart_date, 1, 7) AS month, MIN(c.price) AS price
       FROM calendar_prices c JOIN snapshots s ON s.id = c.snapshot_id
       WHERE s.watch_id = ? GROUP BY s.id, month ORDER BY s.checked_at, s.id`,
    )
    .all(row.id) as { snapshot_id: number; t: string; month: string; price: number }[];
  const series = new Map<string, MonthSeries>();
  for (const q of quotes) {
    let entry = series.get(q.month);
    if (!entry) series.set(q.month, (entry = { month: q.month, points: [], latestPrice: null }));
    entry.points.push({ t: q.t, price: q.price });
    if (q.snapshot_id === latest.id) entry.latestPrice = q.price;
  }

  return {
    scannedAt: latest.checked_at,
    range: { start: first.departDate, end: last.departDate },
    days,
    months: summarizeMonths(days, before ? calendarOf(ctx, before.id) : null),
    // Months that have left the window are history; the chart is about the ones still bookable.
    monthSeries: [...series.values()].filter((s) => s.latestPrice != null).sort((a, b) => a.month.localeCompare(b.month)),
    scanCost: flexScanSearches(ctx),
  };
}

export function getWatchDetail(ctx: Ctx, id: number): WatchDetail {
  const row = getRow(ctx, id);
  const snapshots = snapshotsFor(ctx, id);
  const watch = summarize(ctx, row, snapshots);
  const latestCheck = snapshots.findLast((s) => s.source === 'check') ?? null;

  const history: HistoryPoint[] = snapshots
    .filter((s): s is SnapshotRow & { min_price: number } => s.min_price != null)
    .map((s) => ({ t: s.checked_at, price: s.min_price, source: s.source }));

  const quotes = ctx.db
    .prepare(
      `SELECT s.id AS snapshot_id, s.checked_at AS t, a.airline_code AS code, a.airline_name AS name, a.airline_logo AS logo, a.min_price AS price
       FROM snapshot_airlines a JOIN snapshots s ON s.id = a.snapshot_id
       WHERE s.watch_id = ? ORDER BY s.checked_at, s.id`,
    )
    .all(id) as { snapshot_id: number; t: string; code: string; name: string; logo: string | null; price: number }[];
  const series = new Map<string, AirlineSeries>();
  for (const q of quotes) {
    let entry = series.get(q.code);
    if (!entry) {
      entry = { airline: { code: q.code, name: q.name, logoUrl: q.logo }, points: [], latestPrice: null };
      series.set(q.code, entry);
    }
    entry.airline = { code: q.code, name: q.name, logoUrl: q.logo ?? entry.airline.logoUrl };
    entry.points.push({ t: q.t, price: q.price });
    if (latestCheck && q.snapshot_id === latestCheck.id) entry.latestPrice = q.price;
  }
  const airlineSeries = [...series.values()].sort((a, b) => (a.latestPrice ?? Infinity) - (b.latestPrice ?? Infinity) || a.airline.name.localeCompare(b.airline.name));

  const typicalRange: [number, number] | null =
    latestCheck?.typical_low != null && latestCheck.typical_high != null ? [latestCheck.typical_low, latestCheck.typical_high] : null;
  const stats = computeStats(history);
  // When the last check found nothing, "current" must not silently fall back to an older price.
  if (watch.currentPrice == null) stats.current = null;

  const latest = row.latest_json ? (JSON.parse(row.latest_json) as LatestOffers) : null;
  // For a flexible trip the signal is about booking the cheapest date found.
  const departure = row.kind === 'flex' ? watch.query.departDate : row.depart_date;
  return {
    watch,
    history,
    airlineSeries,
    typicalRange,
    latest: latest ? { ...latest, airports: referencedAirports(watch.query, latest.offers) } : null,
    stats,
    verdict: computeVerdict({
      stats,
      level: watch.level,
      typicalRange,
      daysToDeparture: departure ? daysBetween(toDateString(ctx.now()), departure) : 0,
      format: moneyFormatter(row.currency),
    }),
    alerts: listAlerts(ctx, { watchId: id, limit: 50 }),
    provider: ctx.provider.info,
    calendar: row.kind === 'flex' ? calendarDetail(ctx, row, snapshots) : null,
  };
}

const insertSnapshotSql =
  'INSERT INTO snapshots (watch_id, checked_at, source, min_price, offer_count, level, typical_low, typical_high) VALUES (?, ?, ?, ?, ?, ?, ?, ?)';

/** Marks a watch as checked now and schedules its next check. */
function markChecked(ctx: Ctx, row: WatchRow, latestJson: string | null): void {
  const now = ctx.now();
  ctx.db.prepare('UPDATE watches SET last_checked_at = ?, next_check_at = ?, last_error = NULL, latest_json = ? WHERE id = ?').run(
    now.toISOString(),
    new Date(now.getTime() + row.check_interval_hours * HOUR_MS).toISOString(),
    latestJson,
    row.id,
  );
}

/** Stores the outcome of a search as an observation of this watch, raising alerts where warranted. */
function recordCheck(ctx: Ctx, row: WatchRow, stored: StoredSearch, mode: CheckMode): void {
  const { db } = ctx;
  const offers = stored.result.offers;
  const fetchedMs = new Date(stored.fetchedAt).getTime();

  const insertSnapshot = db.prepare(insertSnapshotSql);
  const insertQuote = db.prepare(
    'INSERT OR REPLACE INTO snapshot_airlines (snapshot_id, airline_code, airline_name, airline_logo, min_price) VALUES (?, ?, ?, ?, ?)',
  );

  db.transaction(() => {
    const existing = snapshotsFor(ctx, row.id);
    const times = existing.map((s) => new Date(s.checked_at).getTime());

    // Back-fill from the provider's own price history wherever this app has no
    // observation nearby: before tracking started, or while it was not running.
    for (const point of stored.result.history) {
      const t = new Date(point.t).getTime();
      if (!Number.isFinite(t) || t > fetchedMs - BACKFILL_GAP_MS) continue;
      if (times.some((other) => Math.abs(other - t) < BACKFILL_GAP_MS)) continue;
      const iso = new Date(t).toISOString();
      const { lastInsertRowid } = insertSnapshot.run(row.id, iso, 'history', point.price, 0, null, null, null);
      for (const q of point.airlines ?? []) insertQuote.run(lastInsertRowid, q.airline.code, q.airline.name, q.airline.logoUrl, q.price);
      times.push(t);
      existing.push({ id: Number(lastInsertRowid), checked_at: iso, source: 'history', min_price: point.price, level: null, typical_low: null, typical_high: null });
    }

    const alreadyRecorded = existing.some((s) => s.source === 'check' && s.checked_at === stored.fetchedAt);
    if (!alreadyRecorded) {
      const minPrice = offers.length ? Math.min(...offers.map((o) => o.price)) : null;
      const insights = stored.result.insights;
      const { lastInsertRowid } = insertSnapshot.run(
        row.id,
        stored.fetchedAt,
        'check',
        minPrice,
        offers.length,
        insights?.level ?? null,
        insights?.typicalRange?.[0] ?? null,
        insights?.typicalRange?.[1] ?? null,
      );

      const cheapestByAirline = new Map<string, { airline: AirlineRef; price: number }>();
      for (const offer of offers) {
        const seen = cheapestByAirline.get(offer.airline.code);
        if (!seen || offer.price < seen.price) cheapestByAirline.set(offer.airline.code, { airline: offer.airline, price: offer.price });
      }
      for (const { airline, price } of cheapestByAirline.values()) insertQuote.run(lastInsertRowid, airline.code, airline.name, airline.logoUrl, price);

      if (mode !== 'initial' && minPrice != null) {
        const before = existing
          .filter((s): s is SnapshotRow & { min_price: number } => s.min_price != null && s.checked_at < stored.fetchedAt)
          .sort((a, b) => a.checked_at.localeCompare(b.checked_at));
        const drafts = evaluateAlerts({
          route: `${row.origin} → ${row.destination}`,
          current: minPrice,
          previous: before[before.length - 1]?.min_price ?? null,
          lowestBefore: before.length ? Math.min(...before.map((s) => s.min_price)) : null,
          priorObservations: before.length,
          targetPrice: row.target_price,
          dropPct: ctx.config.dropAlertPct,
          format: moneyFormatter(row.currency),
        });
        insertAlerts(ctx, row.id, drafts, stored.fetchedAt);
      }
    }

    const latest: LatestOffers = {
      offers: offers.map(publicOffer),
      fetchedAt: stored.fetchedAt,
      externalUrl: stored.result.externalUrl ?? googleFlightsUrl(stored.query),
    };
    markChecked(ctx, row, JSON.stringify(latest));
  })();
}

/** Stores one scan of a flexible watch: the cheapest fare overall, and the fare for every date. */
function recordScan(ctx: Ctx, row: WatchRow, scan: CalendarScan, mode: CheckMode): void {
  const { db } = ctx;
  db.transaction(() => {
    const existing = snapshotsFor(ctx, row.id);
    const alreadyRecorded = existing.some((s) => s.source === 'check' && s.checked_at === scan.fetchedAt);
    if (!alreadyRecorded) {
      const minPrice = scan.days.length ? Math.min(...scan.days.map((d) => d.price)) : null;
      const { lastInsertRowid } = db.prepare(insertSnapshotSql).run(row.id, scan.fetchedAt, 'check', minPrice, scan.days.length, null, null, null);
      const insertDay = db.prepare('INSERT OR REPLACE INTO calendar_prices (snapshot_id, depart_date, return_date, price) VALUES (?, ?, ?, ?)');
      for (const day of scan.days) insertDay.run(lastInsertRowid, day.departDate, day.returnDate, day.price);

      if (mode !== 'initial' && minPrice != null) {
        const before = existing.filter((s): s is SnapshotRow & { min_price: number } => s.source === 'check' && s.min_price != null && s.checked_at < scan.fetchedAt);
        const last = before[before.length - 1];
        const drafts = evaluateFlexAlerts({
          route: `${row.origin} → ${row.destination}`,
          current: scan.days,
          previous: last ? calendarOf(ctx, last.id) : [],
          lowestBefore: before.length ? Math.min(...before.map((s) => s.min_price)) : null,
          priorScans: before.length,
          targetPrice: row.target_price,
          dropPct: ctx.config.dropAlertPct,
          format: moneyFormatter(row.currency),
        });
        insertAlerts(ctx, row.id, drafts, scan.fetchedAt);
      }
    }
    markChecked(ctx, row, null);
  })();
}

/** Looks up current fares for a watch and records them. Throws when the provider call fails. */
export async function checkWatch(ctx: Ctx, id: number, mode: CheckMode): Promise<void> {
  const row = getRow(ctx, id);
  if (isExpired(ctx, row)) {
    ctx.db.prepare('UPDATE watches SET next_check_at = NULL WHERE id = ?').run(id);
    if (mode === 'manual') throw new HttpError(400, 'This trip has already departed, so it is no longer checked.', 'expired');
    return;
  }

  // A manual check always fetches fresh fares. A scheduled one may reuse a
  // search made in the last half hour; the first check reuses the search the
  // user just ran, so starting to track a route costs nothing extra.
  const options = { force: mode === 'manual', maxAgeMinutes: mode === 'scheduled' ? 30 : ctx.config.cacheMinutes };
  try {
    if (row.kind === 'flex') recordScan(ctx, row, await runCalendar(ctx, rowToFlex(row), options), mode);
    else recordCheck(ctx, row, (await runSearch(ctx, rowToQuery(row), options)).stored, mode);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Check failed';
    const outOfBudget = err instanceof HttpError && err.code === 'budget_exhausted';
    const retryHours = outOfBudget ? 12 : Math.min(row.check_interval_hours, 2);
    ctx.db
      .prepare('UPDATE watches SET last_error = ?, next_check_at = ? WHERE id = ?')
      .run(message, new Date(ctx.now().getTime() + retryHours * HOUR_MS).toISOString(), id);
    throw err;
  }
}

export async function createWatch(ctx: Ctx, input: CreateWatchInput): Promise<{ watch: WatchSummary; created: boolean }> {
  const flex = input.flex ?? null;
  const q = input.query ?? null;
  if ((flex == null) === (q == null)) throw new HttpError(400, 'Give either a trip with dates or a flexible trip', 'invalid_request');
  if (q && q.departDate < toDateString(ctx.now())) throw new HttpError(400, 'The departure date is in the past', 'invalid_date');
  if (flex && !ctx.provider.info.calendarMaxDays) throw new HttpError(501, 'This data source cannot search flexible dates.', 'flex_unsupported');

  const trip = (flex ?? q) as FlexQuery | SearchQuery;
  const duplicate = (
    flex
      ? ctx.db
          .prepare(
            `SELECT id FROM watches WHERE kind = 'flex' AND origin = ? AND destination = ? AND trip_days IS ? AND window_days = ?
             AND adults = ? AND cabin = ? AND currency = ? AND max_stops IS ?`,
          )
          .get(flex.origin, flex.destination, flex.tripDays, flex.windowDays, flex.adults, flex.cabin, flex.currency, flex.maxStops)
      : ctx.db
          .prepare(
            `SELECT id FROM watches WHERE kind = 'fixed' AND origin = ? AND destination = ? AND depart_date = ? AND return_date IS ?
             AND adults = ? AND cabin = ? AND currency = ? AND max_stops IS ?`,
          )
          .get(trip.origin, trip.destination, (q as SearchQuery).departDate, (q as SearchQuery).returnDate, trip.adults, trip.cabin, trip.currency, trip.maxStops)
  ) as { id: number } | undefined;
  if (duplicate) {
    if (input.targetPrice !== undefined) ctx.db.prepare('UPDATE watches SET target_price = ? WHERE id = ?').run(input.targetPrice, duplicate.id);
    return { watch: getWatchSummary(ctx, duplicate.id), created: false };
  }

  const now = ctx.now().toISOString();
  const { lastInsertRowid } = ctx.db
    .prepare(
      `INSERT INTO watches (kind, origin, destination, depart_date, return_date, trip_days, window_days, adults, cabin, currency, max_stops,
         target_price, active, check_interval_hours, created_at, next_check_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    )
    .run(
      flex ? 'flex' : 'fixed',
      trip.origin, trip.destination, q?.departDate ?? '', q?.returnDate ?? null, flex?.tripDays ?? null, flex?.windowDays ?? null,
      trip.adults, trip.cabin, trip.currency, trip.maxStops,
      input.targetPrice ?? null, input.checkIntervalHours ?? ctx.config.checkIntervalHours, now, now,
    );
  const id = Number(lastInsertRowid);
  try {
    await checkWatch(ctx, id, 'initial');
  } catch {
    // The watch exists either way; the failure is stored in last_error and the scheduler retries.
  }
  return { watch: getWatchSummary(ctx, id), created: true };
}

export function updateWatch(ctx: Ctx, id: number, patch: UpdateWatchInput): WatchSummary {
  const row = getRow(ctx, id);
  const active = patch.active ?? row.active === 1;
  const reactivated = active && row.active !== 1;
  ctx.db
    .prepare('UPDATE watches SET target_price = ?, active = ?, check_interval_hours = ?, next_check_at = ? WHERE id = ?')
    .run(
      patch.targetPrice === undefined ? row.target_price : patch.targetPrice,
      active ? 1 : 0,
      patch.checkIntervalHours ?? row.check_interval_hours,
      reactivated ? ctx.now().toISOString() : row.next_check_at,
      id,
    );
  return getWatchSummary(ctx, id);
}

export function deleteWatch(ctx: Ctx, id: number): void {
  getRow(ctx, id);
  ctx.db.prepare('DELETE FROM watches WHERE id = ?').run(id);
}

/** Ids of active, not-yet-departed watches whose next check is due. */
export function dueWatchIds(ctx: Ctx, limit: number): number[] {
  const now = ctx.now();
  const rows = ctx.db
    .prepare(
      `SELECT id FROM watches
       WHERE active = 1 AND (kind = 'flex' OR depart_date >= ?) AND (next_check_at IS NULL OR next_check_at <= ?)
       ORDER BY next_check_at LIMIT ?`,
    )
    .all(toDateString(now), now.toISOString(), limit) as { id: number }[];
  return rows.map((r) => r.id);
}

/** Provider searches per month the active watches will use at their current intervals. */
export function projectedMonthlySearches(ctx: Ctx): number {
  const { costPerSearch } = ctx.provider.info;
  if (costPerSearch <= 0) return 0;
  const rows = ctx.db
    .prepare("SELECT kind, check_interval_hours AS h FROM watches WHERE active = 1 AND (kind = 'flex' OR depart_date >= ?)")
    .all(toDateString(ctx.now())) as { kind: WatchKind; h: number }[];
  const perCheck = (r: (typeof rows)[number]) => (r.kind === 'flex' ? flexScanSearches(ctx) : costPerSearch);
  return Math.round(rows.reduce((sum, r) => sum + ((30 * 24) / r.h) * perCheck(r), 0));
}
