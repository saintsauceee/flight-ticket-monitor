import { describe, expect, it } from 'vitest';
import type { Meta, SearchResult, WatchDetail, WatchSummary } from '@shared/types';
import { createApp } from '../src/app';
import { MockProvider } from '../src/providers/mock/provider';
import { makeCtx } from './helpers';

function setup() {
  const ctx = makeCtx(new MockProvider());
  const app = createApp(ctx);
  const call = async <T>(method: string, path: string, body?: unknown): Promise<{ status: number; json: T }> => {
    const res = await app.request(path, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    return { status: res.status, json: (res.status === 204 ? null : await res.json()) as T };
  };
  return { ctx, call };
}

const search = 'origin=jfk&destination=lhr&departDate=2027-01-20&returnDate=2027-01-27';

describe('HTTP API', () => {
  it('describes the data source', async () => {
    const { call } = setup();
    const { status, json } = await call<Meta>('GET', '/api/meta');
    expect(status).toBe(200);
    expect(json).toMatchObject({ provider: { id: 'mock', demo: true }, usage: { used: 0, budget: null }, defaultCheckIntervalHours: 6 });
  });

  it('searches with normalised, defaulted parameters', async () => {
    const { call } = setup();
    const { status, json } = await call<SearchResult>('GET', `/api/search?${search}`);
    expect(status).toBe(200);
    expect(json.query).toEqual({
      origin: 'JFK', destination: 'LHR', departDate: '2027-01-20', returnDate: '2027-01-27',
      adults: 1, cabin: 'economy', currency: 'USD', maxStops: null,
    });
    expect(json.offers.length).toBeGreaterThan(0);
    expect(json.insights?.history).toHaveLength(60);
    expect(json.airports.JFK?.city).toBe('New York');
    expect(json.externalUrl).toContain('google.com/travel/flights');
    expect((await call<SearchResult>('GET', `/api/search?${search}`)).json.cached).toBe(true);
    expect((await call<SearchResult>('GET', `/api/search?${search}&refresh=1`)).json.cached).toBe(false);
  });

  it('rejects bad input with a readable message', async () => {
    const { call } = setup();
    const bad = async (qs: string) => (await call<{ error: string }>('GET', `/api/search?${qs}`)).json.error;
    expect(await bad('origin=JFK&destination=JFK&departDate=2027-01-20')).toMatch(/must differ/);
    expect(await bad('origin=JFK&destination=LHR&departDate=2027-02-30')).toMatch(/YYYY-MM-DD/);
    expect(await bad('origin=JFK&destination=LHR&departDate=2020-01-01')).toMatch(/past/);
    expect(await bad('origin=JFK&destination=LHR&departDate=2027-01-20&returnDate=2027-01-01')).toMatch(/before the departure/);
    expect(await bad('origin=JFK&destination=LHR&departDate=2027-01-20&adults=12')).toMatch(/adults/);
    expect(await bad('origin=JFKX&destination=LHR&departDate=2027-01-20')).toMatch(/3-letter airport code/);
    expect((await call('GET', '/api/search?origin=JFK&destination=ZZZ&departDate=2027-01-20')).status).toBe(400);
    expect((await call('POST', '/api/watches', '{not json')).status).toBe(400);
    expect((await call('GET', '/api/unknown')).status).toBe(404);
  });

  it('runs the whole tracking flow', async () => {
    const { call, ctx } = setup();
    const query = { origin: 'JFK', destination: 'LHR', departDate: '2027-01-20', returnDate: '2027-01-27' };

    const created = await call<WatchSummary>('POST', '/api/watches', { query, targetPrice: 300 });
    expect(created.status).toBe(201);
    expect(created.json.currentPrice).toBeGreaterThan(0);
    expect(created.json.observations).toBe(61);
    expect((await call('POST', '/api/watches', { query })).status).toBe(200);

    const id = created.json.id;
    expect((await call<WatchSummary[]>('GET', '/api/watches')).json).toHaveLength(1);

    const detail = await call<WatchDetail>('GET', `/api/watches/${id}`);
    expect(detail.json.history).toHaveLength(61);
    expect(detail.json.airlineSeries.length).toBeGreaterThan(2);
    expect(detail.json.latest?.offers.length).toBeGreaterThan(0);
    expect(['buy', 'fair', 'wait']).toContain(detail.json.verdict.kind);

    ctx.advance(6);
    const checked = await call<WatchDetail>('POST', `/api/watches/${id}/check`);
    expect(checked.json.history).toHaveLength(62);

    const patched = await call<WatchSummary>('PATCH', `/api/watches/${id}`, { targetPrice: null, active: false });
    expect(patched.json).toMatchObject({ targetPrice: null, active: false });
    expect((await call('PATCH', `/api/watches/${id}`, { checkIntervalHours: 0 })).status).toBe(400);

    const alerts = await call<{ alerts: unknown[]; unread: number }>('GET', '/api/alerts');
    expect(alerts.json.unread).toBe(alerts.json.alerts.length);
    expect((await call<{ unread: number }>('POST', '/api/alerts/read', {})).json.unread).toBe(0);

    expect((await call('DELETE', `/api/watches/${id}`)).status).toBe(204);
    expect((await call('GET', `/api/watches/${id}`)).status).toBe(404);
    expect((await call('GET', '/api/watches/abc')).status).toBe(404);
  });

  it('serves the cheapest fare per day around a date', async () => {
    const { call } = setup();
    const { json } = await call<{ days: { departDate: string; minPrice: number | null; fetched: boolean }[] }>('GET', `/api/calendar?${search}&window=2`);
    expect(json.days.map((d) => d.departDate)).toEqual(['2027-01-18', '2027-01-19', '2027-01-20', '2027-01-21', '2027-01-22']);
    expect(json.days.every((d) => d.fetched && (d.minPrice ?? 0) > 0)).toBe(true);
  });

  it('only answers the app itself', async () => {
    const { ctx } = setup();
    const app = createApp(ctx);
    const status = async (path: string, init: RequestInit) => (await app.request(path, init)).status;
    const post = (headers: Record<string, string>) => status('/api/alerts/read', { method: 'POST', body: '{}', headers });

    // The app's own requests: same origin, in production and through the dev proxy.
    expect(await post({ host: '127.0.0.1:8787', origin: 'http://127.0.0.1:8787', 'sec-fetch-site': 'same-origin' })).toBe(200);
    expect(await post({ host: 'localhost:5173', origin: 'http://localhost:5173' })).toBe(200);
    // Scripts and curl send neither header.
    expect(await post({ host: '127.0.0.1:8787' })).toBe(200);

    // Another website open in the same browser.
    expect(await post({ host: '127.0.0.1:8787', origin: 'https://evil.example' })).toBe(403);
    expect(await post({ host: '127.0.0.1:8787', origin: 'null' })).toBe(403);
    expect(await status('/api/search?origin=JFK&destination=LHR&departDate=2027-01-20', { headers: { host: '127.0.0.1:8787', 'sec-fetch-site': 'cross-site' } })).toBe(403);
    // DNS rebinding: the request arrives here but is addressed to another name.
    expect(await status('/api/meta', { headers: { host: 'evil.example:8787' } })).toBe(403);

    // Deliberately exposed on the network: other host names are expected, cross-site writes still are not.
    const lan = createApp({ ...ctx, config: { ...ctx.config, host: '0.0.0.0' } });
    expect((await lan.request('/api/meta', { headers: { host: '192.168.1.20:8787' } })).status).toBe(200);
    expect((await lan.request('/api/alerts/read', { method: 'POST', body: '{}', headers: { host: '192.168.1.20:8787', origin: 'https://evil.example' } })).status).toBe(403);
  });

  it('autocompletes airports', async () => {
    const { call } = setup();
    const { json } = await call<{ code: string }[]>('GET', '/api/airports?q=heathrow');
    expect(json[0]?.code).toBe('LHR');
  });
});
