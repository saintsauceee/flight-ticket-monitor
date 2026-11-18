import { describe, expect, it } from 'vitest';
import { bagCost, totalWithBags } from '@shared/bags';
import type { BagRule, PricePoint } from '@shared/types';
import { searchAirports } from '../src/data/airports';
import { evaluateAlerts, type AlertInput } from '../src/services/alerts';
import { computeStats, computeVerdict } from '../src/services/insights';

const included = (quantity = 1): BagRule => ({ status: 'included', quantity, fee: null, feeMax: null, note: null });
const fee = (amount: number | null): BagRule => ({ status: 'fee', quantity: 0, fee: amount, feeMax: null, note: null });
const unknown: BagRule = { status: 'unknown', quantity: null, fee: null, feeMax: null, note: null };
const bags = (carryOn: BagRule, checked: BagRule) => ({ baggage: { carryOn, checked, source: 'simulated' as const } });

describe('bag costs', () => {
  it('is free when everything wanted is included', () => {
    expect(bagCost(bags(included(), included()), { carryOn: 1, checked: 1 }, 2)).toEqual({ cost: 0, complete: true });
    expect(bagCost(bags(fee(30), fee(40)), { carryOn: 0, checked: 0 }, 2)).toEqual({ cost: 0, complete: true });
  });

  it('charges per traveller for bags that are not included', () => {
    expect(bagCost(bags(fee(30), fee(40)), { carryOn: 1, checked: 1 }, 2)).toEqual({ cost: 140, complete: true });
    // Two checked bags wanted, one included: pay for the second.
    expect(bagCost(bags(included(), { ...included(1), fee: 60 }), { carryOn: 1, checked: 2 }, 1)).toEqual({ cost: 60, complete: true });
    expect(bagCost(bags(included(), included(2)), { carryOn: 1, checked: 2 }, 3)).toEqual({ cost: 0, complete: true });
  });

  it('flags totals that rest on an unknown fee', () => {
    expect(bagCost(bags(included(), unknown), { carryOn: 1, checked: 1 }, 1)).toEqual({ cost: 0, complete: false });
    expect(bagCost(bags(fee(25), fee(null)), { carryOn: 1, checked: 1 }, 2)).toEqual({ cost: 50, complete: false });
    // An unknown rule does not matter for a bag nobody is bringing.
    expect(bagCost(bags(included(), unknown), { carryOn: 1, checked: 0 }, 1)).toEqual({ cost: 0, complete: true });
    // One bag is included but a second one has no known price.
    expect(bagCost(bags(included(), included(1)), { carryOn: 0, checked: 2 }, 1)).toEqual({ cost: 0, complete: false });
  });

  it('adds bag fees to the ticket price', () => {
    expect(totalWithBags({ ...bags(fee(30), fee(40)), price: 200 }, { carryOn: 1, checked: 1 }, 1)).toEqual({ total: 270, bagFees: 70, complete: true });
  });
});

describe('alert rules', () => {
  const base: AlertInput = {
    route: 'JFK → LHR', current: 400, previous: 410, lowestBefore: 390, priorObservations: 10,
    targetPrice: null, dropPct: 5, format: (n) => `$${n}`,
  };
  const kinds = (patch: Partial<AlertInput>) => evaluateAlerts({ ...base, ...patch }).map((a) => a.kind);

  it('stays quiet for small moves', () => {
    expect(kinds({})).toEqual([]);
    expect(kinds({ current: 450 })).toEqual([]);
  });

  it('flags a drop at or beyond the threshold', () => {
    expect(kinds({ current: 395, previous: 420 })).toEqual(['price_drop']);
    expect(kinds({ current: 399, previous: 420 })).toEqual(['price_drop']); // exactly 5%
    expect(kinds({ current: 400, previous: 420 })).toEqual([]);
    expect(evaluateAlerts({ ...base, current: 380, previous: 400, lowestBefore: 370 })[0]?.message).toBe('JFK → LHR fell 5% to $380 (was $400).');
  });

  it('prefers "new low" over "drop" for the same move', () => {
    expect(kinds({ current: 350, previous: 420 })).toEqual(['new_low']);
  });

  it('needs a few observations before calling a new low', () => {
    expect(kinds({ current: 389, previous: 395, priorObservations: 2 })).toEqual([]);
    expect(kinds({ current: 389, previous: 395, priorObservations: 3 })).toEqual(['new_low']);
  });

  it('fires the target alert only on the crossing', () => {
    expect(kinds({ targetPrice: 405, current: 400, previous: 410 })).toEqual(['target_hit']);
    expect(kinds({ targetPrice: 405, current: 400, previous: 402 })).toEqual([]);
    expect(kinds({ targetPrice: 400, current: 400, previous: null, lowestBefore: null, priorObservations: 0 })).toEqual(['target_hit']);
  });
});

describe('price statistics', () => {
  const series = (prices: number[], stepHours = 24): PricePoint[] =>
    prices.map((price, i) => ({ t: new Date(Date.UTC(2026, 10, 1) + i * stepHours * 3_600_000).toISOString(), price }));

  it('summarises a series', () => {
    const stats = computeStats(series([500, 520, 480, 510, 490, 470, 505, 495, 460]));
    expect(stats).toMatchObject({
      current: 460, lowest: 460, highest: 520, average: 492, median: 495,
      cheaperThanPct: 100, change24h: -35, change7d: -60, observations: 9, spanDays: 8,
    });
    expect(stats.lowestAt).toBe(series([0, 0, 0, 0, 0, 0, 0, 0, 0])[8]?.t);
  });

  it('does not invent changes without a comparable earlier price', () => {
    expect(computeStats([])).toMatchObject({ current: null, observations: 0, change24h: null });
    expect(computeStats(series([500]))).toMatchObject({ current: 500, cheaperThanPct: null, change24h: null, change7d: null });
    // Two checks six hours apart: nothing a day old to compare with.
    expect(computeStats(series([500, 490], 6)).change24h).toBeNull();
    // The previous observation is a month old: too stale to call a 24h change.
    expect(computeStats(series([500, 490], 24 * 30)).change24h).toBeNull();
  });

  const format = (n: number) => `$${n}`;

  it('says buy when the price is low on every measure', () => {
    const stats = computeStats(series([500, 520, 480, 510, 490, 470, 505, 495, 430]));
    const verdict = computeVerdict({ stats, level: 'low', typicalRange: [470, 520], daysToDeparture: 60, format });
    expect(verdict.kind).toBe('buy');
    expect(verdict.reasons[0]).toBe('Below the typical range for this trip ($470–$520).');
    expect(verdict.reasons.some((r) => r.includes('Cheaper than 100%'))).toBe(true);
  });

  it('says wait when the price is high and departure is far off', () => {
    const stats = computeStats(series([500, 520, 480, 510, 490, 470, 505, 495, 560]));
    expect(computeVerdict({ stats, level: 'high', typicalRange: [470, 520], daysToDeparture: 150, format }).kind).toBe('wait');
  });

  it('leans towards booking close to departure', () => {
    const stats = computeStats(series([500, 505, 495, 500, 505, 500, 495, 500, 502]));
    expect(computeVerdict({ stats, level: 'typical', typicalRange: [480, 520], daysToDeparture: 80, format }).kind).toBe('fair');
    const soon = computeVerdict({ stats, level: 'typical', typicalRange: [480, 520], daysToDeparture: 10, format });
    expect(soon.kind).toBe('buy');
    expect(soon.reasons.at(-1)).toMatch(/10 days away/);
  });

  it('admits when it does not know', () => {
    expect(computeVerdict({ stats: computeStats(series([500, 510])), level: null, typicalRange: null, daysToDeparture: 60, format }).kind).toBe('unknown');
    expect(computeVerdict({ stats: computeStats([]), level: null, typicalRange: null, daysToDeparture: 60, format }).headline).toBe('No price yet');
    expect(computeVerdict({ stats: computeStats(series([500])), level: 'low', typicalRange: [1, 2], daysToDeparture: -1, format }).headline).toBe('Departed');
  });
});

describe('airport search', () => {
  const codes = (q: string, limit = 5) => searchAirports(q, limit).map((a) => a.code);

  it('finds airports by code, city and alias', () => {
    expect(codes('sfo')[0]).toBe('SFO');
    expect(codes('lon').slice(0, 2)).toEqual(['LHR', 'LGW']);
    expect(codes('tokyo').sort()).toEqual(['HND', 'NRT']);
    expect(codes('new york', 3).sort()).toEqual(['EWR', 'JFK', 'LGA']);
    expect(codes('singap')[0]).toBe('SIN');
    expect(codes('heathrow')[0]).toBe('LHR');
  });

  it('suggests major airports for an empty query and nothing for nonsense', () => {
    expect(codes('', 3)).toEqual(['ATL', 'DFW', 'DEN']);
    expect(codes('zzzzqq')).toEqual([]);
  });
});
