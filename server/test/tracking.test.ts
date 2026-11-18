import { describe, expect, it } from 'vitest';
import { HttpError } from '../src/context';
import { listAlerts, markAlertsRead, unreadAlertCount } from '../src/services/alerts';
import { startScheduler } from '../src/services/scheduler';
import { loadOfferDetails, runSearch, scanCalendar, searchFlights } from '../src/services/search';
import { getUsage } from '../src/services/usage';
import {
  checkWatch,
  createWatch,
  deleteWatch,
  dueWatchIds,
  getWatchDetail,
  listWatches,
  projectedMonthlySearches,
  updateWatch,
} from '../src/services/watches';
import { makeCtx, offer, query, ScriptedProvider } from './helpers';

const days = (n: number, from = '2026-11-18T12:00:00Z') => new Date(new Date(from).getTime() - n * 86_400_000).toISOString();

describe('search cache', () => {
  it('serves repeat searches from the cache until it expires', async () => {
    const provider = new ScriptedProvider().next([offer('a', 500)], [offer('a', 480)]);
    const ctx = makeCtx(provider);

    const first = await searchFlights(ctx, query);
    const second = await searchFlights(ctx, query);
    expect([first.cached, second.cached]).toEqual([false, true]);
    expect(provider.calls).toBe(1);

    ctx.advance(1); // past the 10 minute cache
    const third = await searchFlights(ctx, query);
    expect(third.cached).toBe(false);
    expect(third.offers[0]?.price).toBe(480);

    const forced = await searchFlights(ctx, query, true);
    expect(forced.cached).toBe(false);
    expect(provider.calls).toBe(3);
  });

  it('shares one provider call between identical concurrent searches', async () => {
    const provider = new ScriptedProvider(1).next([offer('a', 500)]);
    const ctx = makeCtx(provider);
    const [a, b] = await Promise.all([searchFlights(ctx, query), searchFlights(ctx, query)]);
    expect(provider.calls).toBe(1);
    expect(a.offers).toEqual(b.offers);
    expect(getUsage(ctx).used).toBe(1);
  });

  it('never exposes provider tokens', async () => {
    const provider = new ScriptedProvider().next([{ ...offer('a', 500), ref: { bookingToken: 'TOKEN' } }]);
    const result = await searchFlights(makeCtx(provider), query);
    expect(JSON.stringify(result)).not.toContain('TOKEN');
  });

  it('stops spending when the monthly budget is used up', async () => {
    const provider = new ScriptedProvider(1).next([offer('a', 500)]);
    const ctx = makeCtx(provider, undefined, { serpapi: { apiKey: 'k', monthlyBudget: 2, gl: 'us', deepSearch: false } });
    await searchFlights(ctx, query);
    await searchFlights(ctx, { ...query, departDate: '2027-01-21' });
    expect(getUsage(ctx)).toMatchObject({ used: 2, budget: 2 });
    await expect(searchFlights(ctx, { ...query, departDate: '2027-01-22' })).rejects.toMatchObject({ status: 429, code: 'budget_exhausted' });
    // Cached results stay available.
    expect((await searchFlights(ctx, query)).cached).toBe(true);
    expect(provider.calls).toBe(2);
  });

  it('scans nearby dates, reusing what is cached and reporting when the budget runs out', async () => {
    const provider = new ScriptedProvider(1).next([offer('a', 500)], [offer('a', 450, 'DL')], [offer('a', 470)]);
    const ctx = makeCtx(provider, undefined, { serpapi: { apiKey: 'k', monthlyBudget: 3, gl: 'us', deepSearch: false } });
    await searchFlights(ctx, query); // the centre day is already cached

    const cachedOnly = await scanCalendar(ctx, query, 1, true);
    expect(cachedOnly.days.map((d) => d.fetched)).toEqual([false, true, false]);
    expect(provider.calls).toBe(1);

    const scan = await scanCalendar(ctx, query, 2, false);
    expect(scan.days.map((d) => d.departDate)).toEqual(['2027-01-18', '2027-01-19', '2027-01-20', '2027-01-21', '2027-01-22']);
    expect(scan.days.map((d) => d.returnDate)).toEqual(['2027-01-25', '2027-01-26', '2027-01-27', '2027-01-28', '2027-01-29']);
    expect(scan.days.map((d) => d.minPrice)).toEqual([450, 470, 500, null, null]);
    expect(scan.days[0]?.airline?.code).toBe('DL');
    expect(scan.searchesUsed).toBe(2);
    expect(scan.notice).toMatch(/budget/i);
  });

  it('skips dates in the past when scanning', async () => {
    const provider = new ScriptedProvider().next([offer('a', 500)]);
    const ctx = makeCtx(provider);
    const scan = await scanCalendar(ctx, { ...query, departDate: '2026-11-19', returnDate: null }, 3, false);
    expect(scan.days[0]?.departDate).toBe('2026-11-18');
    expect(scan.days).toHaveLength(5);
  });

  it('loads fare details once and keeps them with the cached search', async () => {
    const provider = new ScriptedProvider(1).next([offer('a', 500, 'BA', { details: 'available', detailsCost: 2 })]);
    let detailCalls = 0;
    provider.loadDetails = async (_q, o) => {
      detailCalls++;
      return { offer: { ...o, details: 'full', detailsCost: 0, fare: { ...o.fare, brand: 'Economy Light' } }, cost: 2 };
    };
    const ctx = makeCtx(provider);
    await searchFlights(ctx, query);

    const detailed = await loadOfferDetails(ctx, query, 'a');
    expect(detailed).toMatchObject({ details: 'full', fare: { brand: 'Economy Light' } });
    expect(getUsage(ctx).used).toBe(3);

    await loadOfferDetails(ctx, query, 'a'); // already complete: no further spend
    expect(detailCalls).toBe(1);
    expect((await searchFlights(ctx, query)).offers[0]?.fare.brand).toBe('Economy Light');
    await expect(loadOfferDetails(ctx, query, 'missing')).rejects.toMatchObject({ status: 404 });
  });
});

describe('tracked routes', () => {
  it('records a first observation and back-fills the provider history', async () => {
    const provider = new ScriptedProvider().next([offer('a', 500, 'BA'), offer('b', 460, 'DL'), offer('c', 520, 'BA')]);
    provider.history = [
      { t: days(3), price: 480, airlines: [{ airline: { code: 'DL', name: 'Airline DL', logoUrl: null }, price: 480 }] },
      { t: days(2), price: 470 },
      { t: days(1), price: 455 },
      { t: days(0.1), price: 461 }, // too close to the check itself to add anything
    ];
    const ctx = makeCtx(provider);

    const { watch, created } = await createWatch(ctx, { query, targetPrice: 400 });
    expect(created).toBe(true);
    expect(watch).toMatchObject({
      currentPrice: 460, previousPrice: 455, lowestPrice: 455, highestPrice: 480, observations: 4,
      level: 'typical', targetPrice: 400, expired: false, unreadAlerts: 0, lastError: null,
      cheapestAirline: { code: 'DL' },
    });
    expect(watch.originAirport?.city).toBe('New York');
    expect(watch.nextCheckAt).toBe('2026-11-18T18:00:00.000Z');

    const detail = getWatchDetail(ctx, watch.id);
    expect(detail.history.map((h) => [h.price, h.source])).toEqual([[480, 'history'], [470, 'history'], [455, 'history'], [460, 'check']]);
    expect(detail.airlineSeries.map((s) => [s.airline.code, s.latestPrice, s.points.length])).toEqual([['DL', 460, 2], ['BA', 500, 1]]);
    expect(detail.typicalRange).toEqual([400, 500]);
    expect(detail.latest?.offers).toHaveLength(3);
    expect(detail.alerts).toEqual([]); // the first check never alerts
    expect(provider.calls).toBe(1);
  });

  it('reuses the search the user just ran instead of spending another one', async () => {
    const provider = new ScriptedProvider(1).next([offer('a', 500)]);
    const ctx = makeCtx(provider);
    await searchFlights(ctx, query);
    await createWatch(ctx, { query });
    expect(provider.calls).toBe(1);
    expect(getUsage(ctx).used).toBe(1);
  });

  it('returns the existing watch for a duplicate route', async () => {
    const ctx = makeCtx(new ScriptedProvider().next([offer('a', 500)]));
    const first = await createWatch(ctx, { query });
    const again = await createWatch(ctx, { query, targetPrice: 450 });
    expect(again.created).toBe(false);
    expect(again.watch.id).toBe(first.watch.id);
    expect(again.watch.targetPrice).toBe(450);
    expect(listWatches(ctx)).toHaveLength(1);
    // A different cabin is a different watch.
    expect((await createWatch(ctx, { query: { ...query, cabin: 'business' } })).created).toBe(true);
  });

  it('raises alerts as the price moves', async () => {
    const provider = new ScriptedProvider().next([offer('a', 500)]);
    provider.history = [{ t: days(3), price: 520 }, { t: days(2), price: 510 }, { t: days(1), price: 505 }];
    const ctx = makeCtx(provider);
    const { watch } = await createWatch(ctx, { query, targetPrice: 450 });
    const check = async (price: number) => {
      provider.next([offer('a', price)]);
      ctx.advance(6);
      await checkWatch(ctx, watch.id, 'scheduled');
    };
    const kinds = () => listAlerts(ctx).map((a) => a.kind);

    await check(498); // marginal new low
    expect(kinds()).toEqual(['new_low']);
    await check(520); // rises: nothing
    await check(499); // -4%: below the 5% threshold, and not a new low
    expect(kinds()).toEqual(['new_low']);
    await check(540);
    await check(505); // -6.5% but above the low: plain drop
    expect(kinds()).toEqual(['price_drop', 'new_low']);
    await check(440); // crosses the target and sets a new low
    expect(kinds().slice(0, 2).sort()).toEqual(['new_low', 'target_hit']);
    await check(430); // still under target: only the new low
    expect(kinds()[0]).toBe('new_low');
    expect(kinds().filter((k) => k === 'target_hit')).toHaveLength(1);

    const newest = listAlerts(ctx)[0]!;
    expect(newest).toMatchObject({ watchId: watch.id, price: 430, previousPrice: 440, currency: 'USD', readAt: null, route: { origin: 'JFK', destination: 'LHR' } });
    expect(newest.message).toBe('JFK → LHR hit a new low of $430, $10 under the previous low.');

    const total = listAlerts(ctx).length;
    expect(unreadAlertCount(ctx)).toBe(total);
    expect(getWatchDetail(ctx, watch.id).watch.unreadAlerts).toBe(total);
    expect(markAlertsRead(ctx, { ids: [newest.id] })).toBe(1);
    expect(markAlertsRead(ctx, { watchId: watch.id })).toBe(total - 1);
    expect(unreadAlertCount(ctx)).toBe(0);
  });

  it('keeps going when a check finds no flights', async () => {
    const provider = new ScriptedProvider().next([offer('a', 500)], []);
    const ctx = makeCtx(provider);
    const { watch } = await createWatch(ctx, { query });
    ctx.advance(6);
    await checkWatch(ctx, watch.id, 'scheduled');
    const detail = getWatchDetail(ctx, watch.id);
    expect(detail.watch.currentPrice).toBeNull();
    expect(detail.watch.lowestPrice).toBe(500);
    expect(detail.stats.current).toBeNull();
    expect(detail.verdict.kind).toBe('unknown');
    expect(detail.history).toHaveLength(1);
  });

  it('stores a failed check and retries sooner', async () => {
    const provider = new ScriptedProvider().next([offer('a', 500)], new Error('upstream exploded'), [offer('a', 490)]);
    const ctx = makeCtx(provider);
    const { watch } = await createWatch(ctx, { query });
    ctx.advance(6);
    await expect(checkWatch(ctx, watch.id, 'scheduled')).rejects.toThrow('upstream exploded');
    let summary = listWatches(ctx)[0]!;
    expect(summary.lastError).toBe('upstream exploded');
    expect(summary.currentPrice).toBe(500);
    expect(summary.nextCheckAt).toBe('2026-11-18T20:00:00.000Z'); // 2h retry instead of the 6h interval

    ctx.advance(2);
    await checkWatch(ctx, watch.id, 'scheduled');
    summary = listWatches(ctx)[0]!;
    expect(summary).toMatchObject({ lastError: null, currentPrice: 490, previousPrice: 500 });
  });

  it('a manual check always fetches fresh fares', async () => {
    const provider = new ScriptedProvider().next([offer('a', 500)], [offer('a', 495)]);
    const ctx = makeCtx(provider);
    const { watch } = await createWatch(ctx, { query });
    ctx.advance(0.05); // three minutes later, still inside the cache window
    await checkWatch(ctx, watch.id, 'manual');
    expect(provider.calls).toBe(2);
    expect(listWatches(ctx)[0]?.currentPrice).toBe(495);
  });

  it('does not record the same cached result twice', async () => {
    const provider = new ScriptedProvider().next([offer('a', 500)]);
    const ctx = makeCtx(provider);
    const { watch } = await createWatch(ctx, { query });
    ctx.advance(0.1);
    await checkWatch(ctx, watch.id, 'scheduled'); // cache is 6 minutes old: reused
    expect(provider.calls).toBe(1);
    expect(getWatchDetail(ctx, watch.id).history).toHaveLength(1);
  });

  it('fills gaps from provider history after downtime without duplicating', async () => {
    const provider = new ScriptedProvider().next([offer('a', 500)]);
    const ctx = makeCtx(provider);
    const { watch } = await createWatch(ctx, { query });

    ctx.advance(24 * 5); // the app was off for five days
    const base = ctx.now().toISOString();
    provider.history = [6, 5, 4, 3, 2, 1].map((n) => ({ t: days(n, base), price: 500 - n }));
    provider.next([offer('a', 470)]);
    await checkWatch(ctx, watch.id, 'scheduled');

    const history = getWatchDetail(ctx, watch.id).history;
    // day -6 predates tracking, day -5 coincides with the first check: neither is added twice.
    expect(history.map((h) => h.price)).toEqual([494, 500, 496, 497, 498, 499, 470]);
    expect(history.filter((h) => h.source === 'check')).toHaveLength(2);
    // The drop is measured against yesterday's price, not the five-day-old check.
    expect(listAlerts(ctx).map((a) => [a.kind, a.previousPrice])).toEqual([['new_low', 494]]);
  });

  it('updates, pauses and deletes', async () => {
    const ctx = makeCtx(new ScriptedProvider().next([offer('a', 500)]));
    const { watch } = await createWatch(ctx, { query });

    expect(updateWatch(ctx, watch.id, { targetPrice: 420, checkIntervalHours: 24 })).toMatchObject({ targetPrice: 420, checkIntervalHours: 24, active: true });
    expect(updateWatch(ctx, watch.id, { targetPrice: null }).targetPrice).toBeNull();

    ctx.advance(48);
    expect(dueWatchIds(ctx, 5)).toEqual([watch.id]);
    updateWatch(ctx, watch.id, { active: false });
    expect(dueWatchIds(ctx, 5)).toEqual([]);
    const resumed = updateWatch(ctx, watch.id, { active: true });
    expect(resumed.nextCheckAt).toBe(ctx.now().toISOString());

    deleteWatch(ctx, watch.id);
    expect(listWatches(ctx)).toEqual([]);
    expect(() => getWatchDetail(ctx, watch.id)).toThrow(HttpError);
    expect((ctx.db.prepare('SELECT COUNT(*) AS n FROM snapshots').get() as { n: number }).n).toBe(0);
  });

  it('stops checking once the trip has departed', async () => {
    const provider = new ScriptedProvider().next([offer('a', 500)]);
    const ctx = makeCtx(provider);
    const { watch } = await createWatch(ctx, { query: { ...query, departDate: '2026-11-20', returnDate: null } });
    ctx.advance(24 * 5);
    expect(dueWatchIds(ctx, 5)).toEqual([]);
    expect(listWatches(ctx)[0]?.expired).toBe(true);
    await checkWatch(ctx, watch.id, 'scheduled');
    expect(provider.calls).toBe(1);
    await expect(checkWatch(ctx, watch.id, 'manual')).rejects.toMatchObject({ code: 'expired' });
    expect(getWatchDetail(ctx, watch.id).verdict.headline).toBe('Departed');
    await expect(createWatch(ctx, { query: { ...query, departDate: '2026-11-01' } })).rejects.toMatchObject({ status: 400 });
  });

  it('estimates the monthly spend of active watches', async () => {
    const provider = new ScriptedProvider(1).next([offer('a', 500)]);
    const ctx = makeCtx(provider);
    expect(projectedMonthlySearches(ctx)).toBe(0);
    await createWatch(ctx, { query, checkIntervalHours: 24 });
    const second = await createWatch(ctx, { query: { ...query, destination: 'CDG' }, checkIntervalHours: 12 });
    expect(projectedMonthlySearches(ctx)).toBe(90);
    updateWatch(ctx, second.watch.id, { active: false });
    expect(projectedMonthlySearches(ctx)).toBe(30);
  });
});

describe('scheduler', () => {
  it('checks watches that are due, a few per pass, and survives failures', async () => {
    const provider = new ScriptedProvider().next([offer('a', 500)]);
    const ctx = makeCtx(provider);
    for (const destination of ['LHR', 'CDG', 'AMS', 'FRA']) await createWatch(ctx, { query: { ...query, destination } });
    const lines: string[] = [];
    const scheduler = startScheduler(ctx, { intervalMs: 3_600_000, batch: 3, log: (l) => lines.push(l) });
    try {
      expect(await scheduler.tick()).toBe(0); // nothing due yet

      ctx.advance(7);
      provider.next([offer('a', 480)], new Error('boom'), [offer('a', 470)], [offer('a', 460)]);
      expect(await scheduler.tick()).toBe(2); // three attempted, one failed
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(/boom/);
      expect(await scheduler.tick()).toBe(1); // the fourth watch; the failed one waits for its retry

      const byDestination = Object.fromEntries(listWatches(ctx).map((w) => [w.query.destination, w]));
      expect(byDestination.LHR?.currentPrice).toBe(480);
      expect(byDestination.CDG).toMatchObject({ currentPrice: 500, lastError: 'boom' });
      expect(byDestination.FRA?.currentPrice).toBe(460);
    } finally {
      scheduler.stop();
    }
  });
});

describe('budgeted provider', () => {
  it('parks a watch for twelve hours when the budget is gone', async () => {
    const provider = new ScriptedProvider(1).next([offer('a', 500)]);
    const ctx = makeCtx(provider, undefined, { serpapi: { apiKey: 'k', monthlyBudget: 1, gl: 'us', deepSearch: false } });
    const { watch } = await createWatch(ctx, { query });
    ctx.advance(6);
    await expect(checkWatch(ctx, watch.id, 'scheduled')).rejects.toMatchObject({ code: 'budget_exhausted' });
    const summary = listWatches(ctx)[0]!;
    expect(summary.lastError).toMatch(/budget/i);
    expect(summary.nextCheckAt).toBe('2026-11-19T06:00:00.000Z');
    expect(provider.calls).toBe(1);
    expect(await runSearch(ctx, query, { cachedOnly: true, maxAgeMinutes: 1 })).toBeNull();
  });
});
