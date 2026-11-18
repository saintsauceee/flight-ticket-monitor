import { describe, expect, it } from 'vitest';
import { getAirport } from '../src/data/airports';
import { MockProvider, routingsFor } from '../src/providers/mock/provider';
import { query } from './helpers';

const provider = new MockProvider();
const now = new Date('2026-11-18T09:00:00Z');

describe('simulated provider', () => {
  it('returns the same answer for the same check', async () => {
    const a = await provider.search(query, now);
    const b = await provider.search(query, now);
    expect(a).toEqual(b);
    expect(a.offers.length).toBeGreaterThan(3);
  });

  it('returns offers sorted by price with both directions on a round trip', async () => {
    const { offers } = await provider.search(query, now);
    const prices = offers.map((o) => o.price);
    expect(prices).toEqual([...prices].sort((x, y) => x - y));
    for (const o of offers) {
      expect(o.price).toBeGreaterThan(0);
      expect(o.slices).toHaveLength(2);
      expect(o.slices[0]?.segments[0]?.from).toBe('JFK');
      expect(o.slices[0]?.segments.at(-1)?.to).toBe('LHR');
      expect(o.slices[1]?.segments[0]?.from).toBe('LHR');
      expect(o.slices[1]?.segments.at(-1)?.to).toBe('JFK');
    }
    expect(new Set(offers.map((o) => o.id)).size).toBe(offers.length);
  });

  it('keeps the offer ids stable between checks while prices drift only a little', async () => {
    const first = await provider.search(query, now);
    const later = await provider.search(query, new Date(now.getTime() + 6 * 3_600_000));
    const before = new Map(first.offers.map((o) => [o.id, o.price]));
    expect(later.offers.map((o) => o.id).sort()).toEqual([...before.keys()].sort());
    for (const o of later.offers) {
      const was = before.get(o.id) as number;
      // A fare can enter or leave a sale between two checks, but not more than that.
      expect(Math.abs(o.price - was) / was).toBeLessThan(0.3);
    }
  });

  it('provides 60 days of history consistent with its own price level', async () => {
    const { history, insights, offers } = await provider.search(query, now);
    expect(history).toHaveLength(60);
    expect(history.map((h) => h.t)).toEqual([...history.map((h) => h.t)].sort());
    expect(history.every((h) => h.price > 0 && (h.airlines?.length ?? 0) > 0)).toBe(true);
    expect(insights?.lowestPrice).toBe(offers[0]?.price);
    const [low, high] = insights?.typicalRange as [number, number];
    expect(low).toBeLessThan(high);
    const expected = (offers[0]?.price as number) < low ? 'low' : (offers[0]?.price as number) > high ? 'high' : 'typical';
    expect(insights?.level).toBe(expected);
  });

  it('honours the nonstop filter', async () => {
    const { offers } = await provider.search({ ...query, maxStops: 0 }, now);
    expect(offers.length).toBeGreaterThan(0);
    expect(offers.every((o) => o.slices.every((s) => s.stops === 0))).toBe(true);
  });

  it('charges more for premium cabins and more travellers', async () => {
    const economy = await provider.search({ ...query, maxStops: 0 }, now);
    const business = await provider.search({ ...query, maxStops: 0, cabin: 'business' }, now);
    const pair = await provider.search({ ...query, maxStops: 0, adults: 2 }, now);
    expect(business.offers[0]?.price).toBeGreaterThan((economy.offers[0]?.price as number) * 2);
    expect(Math.abs((pair.offers[0]?.price as number) - (economy.offers[0]?.price as number) * 2)).toBeLessThanOrEqual(1);
  });

  it('has nothing to sell for a trip that already departed', async () => {
    const { offers, history } = await provider.search({ ...query, departDate: '2026-11-01', returnDate: null }, now);
    expect(offers).toEqual([]);
    expect(history).toEqual([]);
  });

  it('rejects unknown airports', async () => {
    await expect(provider.search({ ...query, destination: 'ZZZ' }, now)).rejects.toMatchObject({ status: 400 });
  });

  it('routes airlines plausibly', () => {
    const codes = (from: string, to: string) =>
      routingsFor(getAirport(from)!, getAirport(to)!).map((r) => `${r.airline.code}${r.via ? `/${r.via.code}` : ''}`);
    // Short-haul Europe: nonstop home and low-cost carriers, no long-haul-only airlines.
    const lhrBcn = codes('LHR', 'BCN');
    expect(lhrBcn).toContain('BA');
    expect(lhrBcn).not.toContain('VS');
    expect(lhrBcn.every((c) => !c.includes('/'))).toBe(true);
    // Ultra-long-haul: only the hub carrier flies it nonstop.
    const jfkSin = codes('JFK', 'SIN');
    expect(jfkSin).toContain('SQ');
    expect(jfkSin.filter((c) => !c.includes('/'))).toEqual(['SQ']);
    // Obscure pair still gets connections.
    expect(codes('TOS', 'USH').length).toBeGreaterThan(0);
  });
});
