import { describe, expect, it } from 'vitest';
import type { Alert, FlexDay, FlexResult, WatchDetail, WatchSummary } from '@shared/types';
import { createApp } from '../src/app';
import { addDays } from '../src/lib/dates';
import { MockProvider } from '../src/providers/mock/provider';
import { SerpApiProvider } from '../src/providers/serpapi/provider';
import { evaluateFlexAlerts, formatDates, listAlerts } from '../src/services/alerts';
import { cheapestDay, monthMoves, runCalendar, searchFlex, summarizeMonths } from '../src/services/flex';
import { startScheduler } from '../src/services/scheduler';
import { checkWatch, createWatch, dueWatchIds, getWatchDetail, listWatches, projectedMonthlySearches } from '../src/services/watches';
import { flex, makeCtx, query, ScriptedProvider } from './helpers';

// The test clock starts on 2026-11-18 (UTC noon): a window starts on the 19th,
// and the longest one (180 days ahead) ends on 2027-05-17.
const START = '2026-11-19';
const END = '2027-05-17';
const day = (departDate: string, price: number, tripDays: number | null = 7): FlexDay => ({
  departDate,
  returnDate: tripDays == null ? null : addDays(departDate, tripDays),
  price,
});
const usd = (n: number) => `$${n}`;

describe('calendar providers', () => {
  it('simulates a fare for every date, matching what a search of that date finds', async () => {
    const provider = new MockProvider();
    const now = new Date('2026-11-18T12:00:00Z');
    const { days, cost } = await provider.calendar({ ...flex, start: START, end: '2026-12-18' }, now);
    expect(cost).toBe(0);
    expect(days.map((d) => d.departDate)).toEqual(Array.from({ length: 30 }, (_, i) => addDays(START, i)));
    expect(days.every((d) => d.returnDate === addDays(d.departDate, 7) && d.price > 0)).toBe(true);
    // Prices differ by date: that is the whole point of looking across dates.
    expect(new Set(days.map((d) => d.price)).size).toBeGreaterThan(10);

    const sample = days[12]!;
    const search = await provider.search({ ...query, departDate: sample.departDate, returnDate: sample.returnDate }, now);
    expect(sample.price).toBe(search.offers[0]!.price);

    const oneWay = await provider.calendar({ ...flex, tripDays: null, start: START, end: '2026-11-25' }, now);
    expect(oneWay.days.every((d) => d.returnDate === null)).toBe(true);
  });

  it('asks SerpApi for the calendar with the documented parameters', async () => {
    const urls: URL[] = [];
    const responses: unknown[] = [
      // Shaped after a live response (November 2026).
      {
        search_metadata: { status: 'Success' },
        prices: [
          { outbound_date: '2026-11-20', return_date: '2026-11-27', price: 874 },
          { outbound_date: '2026-11-19', return_date: '2026-11-26', price: 843 },
          { outbound_date: '2027-02-23', return_date: '2027-03-02', price: 570, low_price: true },
          { outbound_date: 'soon', price: 1 },
          { outbound_date: '2026-11-21', return_date: '2026-11-28' },
        ],
      },
      { prices: [{ outbound_date: '2026-11-19', price: 387 }] },
      { error: "Google Flights Calendar hasn't returned any results for this query.", search_information: { flights_results_state: 'Fully empty' } },
    ];
    const provider = new SerpApiProvider({
      apiKey: 'secret-key',
      gl: 'us',
      deepSearch: false,
      fetch: (async (input: Parameters<typeof fetch>[0]) => {
        urls.push(new URL(String(input)));
        return new Response(JSON.stringify(responses.shift()), { status: 200 });
      }) as typeof fetch,
    });
    expect(provider.info.calendarMaxDays).toBe(180);

    const round = await provider.calendar({ ...flex, start: START, end: '2027-05-20', maxStops: 0, cabin: 'business', adults: 2, currency: 'EUR' });
    expect(Object.fromEntries(urls[0]!.searchParams)).toMatchObject({
      engine: 'google_flights_calendar', departure_id: 'JFK', arrival_id: 'LHR', type: '1', round_trip_days: '7',
      date_range_start: START, date_range_end: '2027-05-20', travel_class: '3', adults: '2', currency: 'EUR', stops: '1', api_key: 'secret-key',
    });
    // Sorted by date; entries without a real date or a fare are dropped.
    expect(round).toEqual({
      cost: 1,
      days: [day('2026-11-19', 843), day('2026-11-20', 874), day('2027-02-23', 570)],
    });

    const oneWay = await provider.calendar({ ...flex, tripDays: null, start: START, end: '2027-05-20' });
    expect(urls[1]!.searchParams.get('type')).toBe('2');
    expect(urls[1]!.searchParams.has('round_trip_days')).toBe(false);
    expect(urls[1]!.searchParams.has('stops')).toBe(false);
    expect(oneWay.days).toEqual([day('2026-11-19', 387, null)]);

    // "No results" is an empty calendar, not a failure.
    expect((await provider.calendar({ ...flex, start: START, end: '2027-05-20' })).days).toEqual([]);
  });
});

describe('flexible search', () => {
  it('prices the whole window, caches it, and refreshes on demand', async () => {
    const provider = new ScriptedProvider(0);
    provider.fare = (date) => (date === '2027-02-23' ? 210 : date.startsWith('2027-05') ? 260 : 300);
    const ctx = makeCtx(provider);

    const result = await searchFlex(ctx, flex);
    expect(result.range).toEqual({ start: START, end: END });
    expect(result.days).toHaveLength(180);
    expect(result.cheapest).toEqual(day('2027-02-23', 210));
    expect(result.cached).toBe(false);
    expect(result.airports.JFK?.city).toBe('New York');
    expect(provider.calendarCalls).toHaveLength(1);
    expect(provider.calendarCalls[0]).toMatchObject({ start: START, end: END, tripDays: 7 });

    const months = result.months;
    expect(months.map((m) => m.month)).toEqual(['2026-11', '2026-12', '2027-01', '2027-02', '2027-03', '2027-04', '2027-05']);
    expect(months.find((m) => m.month === '2027-02')).toMatchObject({ cheapest: day('2027-02-23', 210), days: 28, median: 300, change: null });
    expect(months.find((m) => m.month === '2027-05')).toMatchObject({ days: 17, median: 260 });
    expect(months[0]).toMatchObject({ days: 12, cheapest: day(START, 300) });

    expect((await searchFlex(ctx, flex)).cached).toBe(true);
    expect(provider.calendarCalls).toHaveLength(1);
    ctx.advance(1);
    expect((await searchFlex(ctx, flex)).cached).toBe(false); // the 10-minute cache has expired
    expect((await searchFlex(ctx, flex, true)).cached).toBe(false);
    expect(provider.calendarCalls).toHaveLength(3);
  });

  it('never asks for dates beyond what the calendar reaches', async () => {
    // Overshooting the calendar returns nothing at all, so a longer window is cut down to it.
    const provider = new ScriptedProvider(1, 180);
    const ctx = makeCtx(provider);
    const scan = await runCalendar(ctx, { ...flex, windowDays: 335 });
    expect(provider.calendarCalls.map((c) => [c.start, c.end])).toEqual([[START, END]]);
    expect(scan.days).toHaveLength(180);
    expect(scan.searchesUsed).toBe(1);
    expect(scan.range).toEqual({ start: START, end: END });

    const short = await runCalendar(ctx, { ...flex, windowDays: 30 });
    expect(short.range).toEqual({ start: START, end: '2026-12-18' });
    expect(short.days).toHaveLength(30);
  });

  it('shares one request between identical concurrent scans', async () => {
    const provider = new ScriptedProvider(1);
    const ctx = makeCtx(provider);
    const [a, b] = await Promise.all([runCalendar(ctx, flex), runCalendar(ctx, flex)]);
    expect(provider.calendarCalls).toHaveLength(1);
    expect(a.days).toEqual(b.days);
  });

  it('stops spending when the monthly budget is used up', async () => {
    const provider = new ScriptedProvider(1);
    const ctx = makeCtx(provider, undefined, { serpapi: { apiKey: 'k', monthlyBudget: 1, gl: 'us', deepSearch: false } });
    await runCalendar(ctx, flex);
    await expect(runCalendar(ctx, { ...flex, tripDays: 5 })).rejects.toMatchObject({ code: 'budget_exhausted' });
    expect(provider.calendarCalls).toHaveLength(1);
    // What is already cached is still served.
    expect((await runCalendar(ctx, flex)).cached).toBe(true);
  });

  it('refuses when the data source has no calendar', async () => {
    const ctx = makeCtx(new ScriptedProvider(0, null));
    await expect(searchFlex(ctx, flex)).rejects.toMatchObject({ status: 501, code: 'flex_unsupported' });
    await expect(createWatch(ctx, { flex })).rejects.toMatchObject({ code: 'flex_unsupported' });
  });
});

describe('comparing scans', () => {
  it('finds the cheapest day, preferring the earliest on a tie', () => {
    expect(cheapestDay([day('2027-01-03', 300), day('2027-01-04', 250), day('2027-01-05', 250)])).toEqual(day('2027-01-04', 250));
    expect(cheapestDay([])).toBeNull();
  });

  it('compares months only over the dates both scans cover', () => {
    const previous = [day('2027-01-30', 400), day('2027-01-31', 420), day('2027-02-01', 500)];
    // Jan 30 left the window, Feb 2 entered it cheap: neither is a price change.
    const current = [day('2027-01-31', 380), day('2027-02-01', 500), day('2027-02-02', 300)];
    expect(monthMoves(current, previous)).toEqual([
      { month: '2027-01', current: day('2027-01-31', 380), previous: day('2027-01-31', 420) },
      { month: '2027-02', current: day('2027-02-01', 500), previous: day('2027-02-01', 500) },
    ]);
    const months = summarizeMonths(current, previous);
    expect(months.map((m) => [m.month, m.cheapest.price, m.change])).toEqual([
      ['2027-01', 380, -40],
      ['2027-02', 300, 0],
    ]);
    expect(summarizeMonths(current).every((m) => m.change === null)).toBe(true);
  });

  it('formats alert dates', () => {
    expect(formatDates(day('2027-02-23', 1))).toBe('Feb 23 – Mar 2');
    expect(formatDates(day('2027-02-23', 1, null))).toBe('Feb 23');
  });
});

describe('alerts for flexible trips', () => {
  const steady = [day('2027-02-10', 600), day('2027-02-11', 620), day('2027-05-12', 700), day('2027-05-13', 720), day('2027-06-02', 800)];
  const base = { route: 'JFK → LHR', previous: steady, lowestBefore: 600, priorScans: 5, targetPrice: null, dropPct: 5, format: usd };

  it('stays quiet when nothing moved', () => {
    expect(evaluateFlexAlerts({ ...base, current: steady })).toEqual([]);
    expect(evaluateFlexAlerts({ ...base, current: [] })).toEqual([]);
  });

  it('flags a cheap fare appearing in one month even when another month is still cheapest', () => {
    const current = steady.map((d) => (d.departDate === '2027-05-13' ? { ...d, price: 610 } : d));
    const alerts = evaluateFlexAlerts({ ...base, current });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ kind: 'price_drop', price: 610, previousPrice: 700, departDate: '2027-05-13', returnDate: '2027-05-20' });
    expect(alerts[0]!.message).toBe('JFK → LHR: cheapest May fare fell 13% to $610 (May 13 – May 20), was $700.');
  });

  it('leads with the biggest drop and lists the others', () => {
    const current = [day('2027-02-10', 560), day('2027-02-11', 620), day('2027-05-12', 500), day('2027-05-13', 720), day('2027-06-02', 720)];
    const [alert, ...rest] = evaluateFlexAlerts({ ...base, lowestBefore: 400, current });
    expect(rest).toEqual([]);
    expect(alert!.message).toBe('JFK → LHR: cheapest May fare fell 29% to $500 (May 12 – May 19), was $700. Also down: June −10%, February −7%.');
  });

  it('announces a new low once, not also as that month dropping', () => {
    const current = steady.map((d) => (d.departDate === '2027-02-11' ? { ...d, price: 540 } : d));
    const alerts = evaluateFlexAlerts({ ...base, current });
    expect(alerts.map((a) => a.kind)).toEqual(['new_low']);
    expect(alerts[0]!.message).toBe('JFK → LHR: new low of $540 for Feb 11 – Feb 18, $60 under the lowest seen before.');
    // Too few scans to call anything a record: it is reported as a drop instead.
    expect(evaluateFlexAlerts({ ...base, priorScans: 2, current }).map((a) => a.kind)).toEqual(['price_drop']);
  });

  it('fires the target when the cheapest date crosses it, not on every scan below it', () => {
    const current = steady.map((d) => (d.departDate === '2027-02-10' ? { ...d, price: 590 } : d));
    const hit = evaluateFlexAlerts({ ...base, targetPrice: 595, current });
    expect(hit.map((a) => a.kind)).toEqual(['target_hit', 'new_low']);
    expect(hit[0]!.message).toBe('JFK → LHR from $590 on Feb 10 – Feb 17, at or below your $595 target.');
    expect(evaluateFlexAlerts({ ...base, targetPrice: 595, previous: current, current, lowestBefore: 590 })).toEqual([]);
    // No earlier scan at all (tracking has just begun with a later first scan).
    expect(evaluateFlexAlerts({ ...base, targetPrice: 650, previous: [], lowestBefore: null, priorScans: 0, current: steady }).map((a) => a.kind)).toEqual(['target_hit']);
  });
});

describe('tracking a flexible trip', () => {
  const setup = (cost = 0) => {
    const provider = new ScriptedProvider(cost);
    provider.fare = (date) => (date === '2027-02-23' ? 570 : date.startsWith('2027-05') ? 700 : 800);
    return { provider, ctx: makeCtx(provider) };
  };

  it('records the first scan without alerts and shows the cheapest dates', async () => {
    const { provider, ctx } = setup();
    const { watch, created } = await createWatch(ctx, { flex, targetPrice: 500 });
    expect(created).toBe(true);
    expect(watch).toMatchObject({
      kind: 'flex',
      flex: { tripDays: 7, windowDays: 180 },
      query: { origin: 'JFK', destination: 'LHR', departDate: '2027-02-23', returnDate: '2027-03-02' },
      currentPrice: 570,
      previousPrice: null,
      observations: 1,
      expired: false,
      targetPrice: 500,
      cheapestAirline: null,
    });
    expect(provider.calendarCalls).toHaveLength(1);
    expect(listAlerts(ctx)).toEqual([]);

    const detail = getWatchDetail(ctx, watch.id);
    expect(detail.calendar).toMatchObject({ range: { start: START, end: END }, scanCost: 0 });
    expect(detail.calendar!.days).toHaveLength(180);
    expect(detail.calendar!.months.every((m) => m.change === null)).toBe(true);
    expect(detail.calendar!.monthSeries.map((s) => s.month)).toEqual(['2026-11', '2026-12', '2027-01', '2027-02', '2027-03', '2027-04', '2027-05']);
    expect(detail.history).toEqual([{ t: '2026-11-18T12:00:00.000Z', price: 570, source: 'check' }]);
    expect(detail.latest).toBeNull();
    expect(detail.airlineSeries).toEqual([]);
  });

  it('starts from the scan the user just ran instead of spending another one', async () => {
    const { provider, ctx } = setup(1);
    await searchFlex(ctx, flex);
    await createWatch(ctx, { flex });
    expect(provider.calendarCalls).toHaveLength(1);
  });

  it('returns the existing watch for the same flexible trip, and keeps different ones apart', async () => {
    const { ctx } = setup();
    const first = await createWatch(ctx, { flex });
    const again = await createWatch(ctx, { flex, targetPrice: 450 });
    expect(again).toMatchObject({ created: false, watch: { id: first.watch.id, targetPrice: 450 } });
    expect((await createWatch(ctx, { flex: { ...flex, tripDays: null } })).created).toBe(true);
    expect((await createWatch(ctx, { flex: { ...flex, windowDays: 90 } })).created).toBe(true);
    // A fixed trip on the same route is a different thing to track.
    expect((await createWatch(ctx, { query })).created).toBe(true);
    expect(listWatches(ctx).map((w) => w.kind)).toEqual(['flex', 'flex', 'flex', 'fixed']);
  });

  it('alerts when a cheap fare shows up in a month, with the dates', async () => {
    const { provider, ctx } = setup();
    const { watch } = await createWatch(ctx, { flex });

    ctx.advance(24);
    provider.fare = (date) => (date === '2027-02-23' ? 570 : date === '2027-05-11' ? 590 : date.startsWith('2027-05') ? 700 : 800);
    await checkWatch(ctx, watch.id, 'scheduled');

    const alerts = listAlerts(ctx);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject<Partial<Alert>>({
      kind: 'price_drop',
      price: 590,
      previousPrice: 700,
      message: 'JFK → LHR: cheapest May fare fell 16% to $590 (May 11 – May 18), was $700.',
      route: { origin: 'JFK', destination: 'LHR', departDate: '2027-05-11', returnDate: '2027-05-18', flexible: true },
    });

    const detail = getWatchDetail(ctx, watch.id);
    expect(detail.watch).toMatchObject({ currentPrice: 570, previousPrice: 570, observations: 2, unreadAlerts: 1 });
    expect(detail.calendar!.months.find((m) => m.month === '2027-05')).toMatchObject({ cheapest: day('2027-05-11', 590), change: -110 });
    expect(detail.calendar!.months.find((m) => m.month === '2027-02')).toMatchObject({ change: 0 });
    expect(detail.calendar!.monthSeries.find((s) => s.month === '2027-05')).toEqual({
      month: '2027-05',
      latestPrice: 590,
      points: [
        { t: '2026-11-18T12:00:00.000Z', price: 700 },
        { t: '2026-11-19T12:00:00.000Z', price: 590 },
      ],
    });
    // The window has rolled forward a day.
    expect(detail.calendar!.range).toEqual({ start: '2026-11-20', end: '2027-05-18' });
  });

  it('alerts on the target and on a new low across all dates', async () => {
    const { provider, ctx } = setup();
    const { watch } = await createWatch(ctx, { flex, targetPrice: 520 });
    for (let i = 0; i < 3; i++) {
      ctx.advance(24);
      await checkWatch(ctx, watch.id, 'scheduled');
    }
    expect(listAlerts(ctx)).toEqual([]);

    ctx.advance(24);
    provider.fare = (date) => (date === '2027-03-09' ? 510 : date === '2027-02-23' ? 570 : 800);
    await checkWatch(ctx, watch.id, 'scheduled');
    expect(listAlerts(ctx).map((a) => [a.kind, a.price, a.route.departDate])).toEqual([
      ['new_low', 510, '2027-03-09'],
      ['target_hit', 510, '2027-03-09'],
    ]);
    expect(getWatchDetail(ctx, watch.id).watch.query).toMatchObject({ departDate: '2027-03-09', returnDate: '2027-03-16' });

    // Still below target on the next scan: no repeat.
    ctx.advance(24);
    await checkWatch(ctx, watch.id, 'scheduled');
    expect(listAlerts(ctx)).toHaveLength(2);
  });

  it('never expires, is picked up by the scheduler, and retries after a failure', async () => {
    const { provider, ctx } = setup();
    const { watch } = await createWatch(ctx, { flex });
    expect(dueWatchIds(ctx, 10)).toEqual([]);
    ctx.advance(7);
    expect(dueWatchIds(ctx, 10)).toEqual([watch.id]);

    const scheduler = startScheduler(ctx, { log: () => {} });
    expect(await scheduler.tick()).toBe(1);
    expect(getWatchDetail(ctx, watch.id).watch.observations).toBe(2);

    ctx.advance(7);
    provider.calendarError = new Error('upstream down');
    expect(await scheduler.tick()).toBe(0);
    scheduler.stop();
    const failed = getWatchDetail(ctx, watch.id).watch;
    expect(failed).toMatchObject({ lastError: 'upstream down', observations: 2, expired: false });
    expect(new Date(failed.nextCheckAt!).getTime() - ctx.now().getTime()).toBe(2 * 3_600_000);

    // A year on it is still being scanned: there is no departure date to pass.
    ctx.advance(24 * 365);
    await checkWatch(ctx, watch.id, 'manual');
    expect(getWatchDetail(ctx, watch.id).watch).toMatchObject({ lastError: null, observations: 3, expired: false });
  });

  it('counts one search per scan when estimating monthly spend', async () => {
    const { ctx } = setup(1);
    await createWatch(ctx, { flex, checkIntervalHours: 24 });
    expect(projectedMonthlySearches(ctx)).toBe(30);
    await createWatch(ctx, { flex: { ...flex, windowDays: 90 }, checkIntervalHours: 48 });
    expect(projectedMonthlySearches(ctx)).toBe(30 + 15);
    await createWatch(ctx, { query, checkIntervalHours: 24 });
    expect(projectedMonthlySearches(ctx)).toBe(75);
    expect(getWatchDetail(ctx, 2).calendar?.scanCost).toBe(1);
  });

  it('handles a scan that finds no fares at all', async () => {
    const { provider, ctx } = setup();
    provider.fare = () => null;
    const { watch } = await createWatch(ctx, { flex });
    expect(watch).toMatchObject({ currentPrice: null, observations: 0, query: { departDate: '', returnDate: null } });
    const detail = getWatchDetail(ctx, watch.id);
    expect(detail.calendar).toBeNull();
    expect(detail.verdict.kind).toBe('unknown');
  });
});

describe('flexible trips over HTTP', () => {
  const setup = () => {
    const ctx = makeCtx(new MockProvider());
    const app = createApp(ctx);
    const call = async <T>(method: string, path: string, body?: unknown): Promise<{ status: number; json: T }> => {
      const res = await app.request(path, {
        method,
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, json: (res.status === 204 ? null : await res.json()) as T };
    };
    return { ctx, call };
  };

  it('searches every date with defaulted parameters', async () => {
    const { call } = setup();
    const { status, json } = await call<FlexResult>('GET', '/api/flex?origin=jfk&destination=lhr&tripDays=7');
    expect(status).toBe(200);
    expect(json.query).toEqual({ origin: 'JFK', destination: 'LHR', tripDays: 7, windowDays: 180, adults: 1, cabin: 'economy', currency: 'USD', maxStops: null });
    expect(json.days).toHaveLength(180);
    expect(json.cheapest!.price).toBe(Math.min(...json.days.map((d) => d.price)));
    expect(json.months.length).toBeGreaterThanOrEqual(6);
    expect(json.provider.calendarMaxDays).toBe(180);

    const oneWay = await call<FlexResult>('GET', '/api/flex?origin=JFK&destination=LHR&windowDays=90');
    expect(oneWay.json.query).toMatchObject({ tripDays: null, windowDays: 90 });
    expect(oneWay.json.days).toHaveLength(90);
    expect(oneWay.json.days.every((d) => d.returnDate === null)).toBe(true);
  });

  it('rejects bad input', async () => {
    const { call } = setup();
    const bad = async (qs: string) => (await call<{ error: string }>('GET', `/api/flex?${qs}`)).json.error;
    expect(await bad('origin=JFK&destination=JFK')).toMatch(/must differ/);
    expect(await bad('origin=JFK&destination=LHR&windowDays=335')).toMatch(/windowDays/);
    expect(await bad('origin=JFK&destination=LHR&tripDays=0')).toMatch(/tripDays/);
    expect((await call('GET', '/api/flex?origin=JFK&destination=ZZZ')).status).toBe(400);

    const flexBody = { origin: 'JFK', destination: 'LHR', tripDays: 7 };
    const fixed = { origin: 'JFK', destination: 'LHR', departDate: '2027-01-20' };
    expect((await call('POST', '/api/watches', {})).status).toBe(400);
    expect((await call('POST', '/api/watches', { flex: flexBody, query: fixed })).status).toBe(400);
    expect((await call('POST', '/api/watches', { query: { ...fixed, departDate: '2020-01-01' } })).status).toBe(400);
  });

  it('tracks a flexible trip end to end', async () => {
    const { call, ctx } = setup();
    const created = await call<WatchSummary>('POST', '/api/watches', { flex: { origin: 'JFK', destination: 'LHR', tripDays: 7 }, targetPrice: 100 });
    expect(created.status).toBe(201);
    expect(created.json).toMatchObject({ kind: 'flex', flex: { tripDays: 7, windowDays: 180 }, observations: 1 });
    expect(created.json.query.departDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect((await call('POST', '/api/watches', { flex: { origin: 'JFK', destination: 'LHR', tripDays: 7 } })).status).toBe(200);

    const id = created.json.id;
    ctx.advance(24);
    const checked = await call<WatchDetail>('POST', `/api/watches/${id}/check`);
    expect(checked.status).toBe(200);
    expect(checked.json.history).toHaveLength(2);
    expect(checked.json.calendar!.days).toHaveLength(180);
    expect(checked.json.calendar!.months.some((m) => m.change !== null)).toBe(true);

    const list = await call<WatchSummary[]>('GET', '/api/watches');
    expect(list.json.map((w) => w.kind)).toEqual(['flex']);
    expect((await call('DELETE', `/api/watches/${id}`)).status).toBe(204);
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM calendar_prices').get()).toEqual({ n: 0 });
  });
});
