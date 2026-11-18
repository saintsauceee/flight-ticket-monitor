import type { PriceLevel, PricePoint, PriceStats, Verdict } from '@shared/types';
import { mean, quantile } from '../lib/stats';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** Price at the last observation made at least `agoMs` before the newest one, if that is not too stale to compare. */
function priceBefore(points: readonly PricePoint[], agoMs: number, maxStaleMs: number): number | null {
  const newest = points[points.length - 1];
  if (!newest) return null;
  const anchor = new Date(newest.t).getTime() - agoMs;
  for (let i = points.length - 2; i >= 0; i--) {
    const p = points[i] as PricePoint;
    const t = new Date(p.t).getTime();
    if (t <= anchor) return anchor - t <= maxStaleMs ? p.price : null;
  }
  return null;
}

/** Summary statistics over a price series sorted oldest first. */
export function computeStats(points: readonly PricePoint[]): PriceStats {
  const newest = points[points.length - 1];
  if (!newest) {
    return {
      current: null, lowest: null, lowestAt: null, highest: null, average: null, median: null,
      cheaperThanPct: null, change24h: null, change7d: null, observations: 0, spanDays: 0,
    };
  }
  const prices = points.map((p) => p.price);
  const current = newest.price;
  const lowestPoint = points.reduce((min, p) => (p.price < min.price ? p : min), newest);
  const earlier = prices.slice(0, -1);
  const dayAgo = priceBefore(points, 20 * HOUR_MS, 3 * DAY_MS);
  const weekAgo = priceBefore(points, 6.5 * DAY_MS, 7 * DAY_MS);

  return {
    current,
    lowest: lowestPoint.price,
    lowestAt: lowestPoint.t,
    highest: Math.max(...prices),
    average: Math.round(mean(prices) as number),
    median: Math.round(quantile(prices, 0.5) as number),
    cheaperThanPct: earlier.length ? Math.round((earlier.filter((p) => p > current).length / earlier.length) * 100) : null,
    change24h: dayAgo == null ? null : current - dayAgo,
    change7d: weekAgo == null ? null : current - weekAgo,
    observations: points.length,
    spanDays: Math.round((new Date(newest.t).getTime() - new Date((points[0] as PricePoint).t).getTime()) / DAY_MS),
  };
}

export interface VerdictInput {
  stats: PriceStats;
  level: PriceLevel | null;
  typicalRange: [number, number] | null;
  daysToDeparture: number;
  format: (amount: number) => string;
}

/**
 * A rule-of-thumb buy/wait signal. It weighs where the current price sits in
 * what has been observed, the provider's own price level, the recent trend and
 * how close departure is. It is a summary of evidence, not a forecast.
 */
export function computeVerdict({ stats, level, typicalRange, daysToDeparture, format }: VerdictInput): Verdict {
  if (daysToDeparture < 0) return { kind: 'unknown', headline: 'Departed', reasons: ['This trip is in the past, so it is no longer checked.'] };
  if (stats.current == null) return { kind: 'unknown', headline: 'No price yet', reasons: ['No fares were found on the last check.'] };
  if (stats.observations < 5 && level == null) {
    return { kind: 'unknown', headline: 'Still learning', reasons: ['A signal appears once a few more prices have been collected.'] };
  }

  let score = 0;
  const reasons: string[] = [];
  const days = Math.round(daysToDeparture);

  if (level && typicalRange) {
    const range = `${format(typicalRange[0])}–${format(typicalRange[1])}`;
    if (level === 'low') {
      score += 2;
      reasons.push(`Below the typical range for this trip (${range}).`);
    } else if (level === 'high') {
      score -= 2;
      reasons.push(`Above the typical range for this trip (${range}).`);
    } else {
      reasons.push(`Within the typical range for this trip (${range}).`);
    }
  }

  if (stats.cheaperThanPct != null && stats.observations >= 8) {
    const span = stats.spanDays >= 2 ? `the last ${stats.spanDays} days` : 'recent checks';
    if (stats.cheaperThanPct >= 80) {
      score += 2;
      reasons.push(`Cheaper than ${stats.cheaperThanPct}% of the prices seen over ${span}.`);
    } else if (stats.cheaperThanPct <= 20) {
      score -= 2;
      reasons.push(`More expensive than ${100 - stats.cheaperThanPct}% of the prices seen over ${span}.`);
    }
  }

  if (stats.change7d != null && stats.current > 0) {
    const pct = Math.round((stats.change7d / (stats.current - stats.change7d)) * 100);
    if (pct >= 4) {
      if (days <= 45) score += 1;
      reasons.push(`Up ${pct}% over the past week.`);
    } else if (pct <= -4) {
      if (level !== 'low') score -= 1;
      reasons.push(`Down ${Math.abs(pct)}% over the past week.`);
    }
  }

  if (days <= 21) {
    score += 2;
    reasons.push(`Departure is ${days === 0 ? 'today' : days === 1 ? 'tomorrow' : `${days} days away`}; fares usually climb this close in.`);
  } else if (days <= 35) {
    score += 1;
    reasons.push('About a month out, when fares tend to start rising.');
  } else if (days > 120 && level !== 'low') {
    score -= 1;
    reasons.push('Departure is more than four months away, so there is time to watch.');
  }

  if (score >= 2) return { kind: 'buy', headline: 'Good time to book', reasons };
  if (score <= -2) return { kind: 'wait', headline: 'Worth waiting', reasons };
  return { kind: 'fair', headline: 'Fair price', reasons };
}
