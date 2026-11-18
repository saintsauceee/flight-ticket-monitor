// Simulated flight provider.
//
// Produces plausible schedules and fares without any network access so the app
// can be used (and tested) before a real data source is connected. Prices are
// a pure function of (route, dates, airline, flight, time of the check): the
// same check always returns the same answer, and checking again later moves
// each fare smoothly, the way real fares drift, jump and go on sale.

import type {
  Airport,
  AirlineRef,
  Amenities,
  BagRule,
  Baggage,
  CabinClass,
  FareRules,
  Layover,
  SearchQuery,
  Segment,
  Slice,
} from '@shared/types';
import { getAirport } from '../../data/airports';
import { addDays, dayOfWeek, daysUntil, localStamp, parseDate } from '../../lib/dates';
import { haversineKm } from '../../lib/geo';
import { pick, rand, randInt, shortId, valueNoise } from '../../lib/hash';
import { interpolate, quantile } from '../../lib/stats';
import {
  ProviderError,
  type CalendarQuery,
  type FlightProvider,
  type ProviderCalendarResult,
  type ProviderHistoryPoint,
  type ProviderOffer,
  type ProviderSearchResult,
} from '../types';
import { AIRLINES, type BagPolicy, type MockAirline } from './airlines';

const DAY_MS = 86_400_000;
const HISTORY_DAYS = 60;
const MAX_NONSTOP_KM = 15_500;
const MIN_LEG_KM = 250;
const MAX_AIRLINES = 9;

/** Approximate USD exchange rates, good enough for simulated prices. */
const FX: Record<string, number> = {
  USD: 1, EUR: 0.92, GBP: 0.79, CAD: 1.38, AUD: 1.52, NZD: 1.67, SGD: 1.34, HKD: 7.8, JPY: 150, CNY: 7.2,
  KRW: 1380, INR: 84, THB: 35, AED: 3.67, CHF: 0.88, SEK: 10.5, MXN: 18.5, BRL: 5.6,
};

function money(usd: number, currency: string): number {
  const value = usd * (FX[currency] ?? 1);
  if (value >= 20_000) return Math.round(value / 100) * 100;
  if (value >= 2_000 && (FX[currency] ?? 1) >= 30) return Math.round(value / 10) * 10;
  return Math.round(value);
}

const CABIN_MULTIPLIER: Record<CabinClass, number> = { economy: 1, premium_economy: 1.7, business: 3.6, first: 6 };
const CABIN_EMISSIONS: Record<CabinClass, number> = { economy: 1, premium_economy: 1.5, business: 2.9, first: 4 };

// Fare multiplier by days before departure: cheapest about two months out,
// climbing steeply in the last three weeks.
const ADVANCE_CURVE = [
  [0, 1.9], [3, 1.7], [7, 1.42], [14, 1.2], [21, 1.06], [35, 0.97], [60, 0.92], [90, 0.95], [150, 1.0], [330, 1.04],
] as const;
const DOW_FACTOR = [1.1, 1.0, 0.93, 0.93, 1.0, 1.1, 0.96]; // Sunday first
const MONTH_FACTOR = [0.92, 0.9, 0.97, 1.0, 1.02, 1.1, 1.18, 1.15, 1.0, 0.96, 0.93, 1.1];
const DEPARTURE_SLOTS = [370, 500, 640, 780, 930, 1070, 1210, 1320]; // minutes after midnight

interface Routing {
  airline: MockAirline;
  via: Airport | null;
  detour: number;
  home: boolean;
}

interface SlicePlan {
  slice: Slice;
  /** Identifies the flights of this slice regardless of date. */
  key: string;
  priceUsd(now: Date): number;
  flownKm: number;
}

interface OfferPlan {
  offer: Omit<ProviderOffer, 'price'>;
  airline: AirlineRef;
  priceAt(now: Date): number;
}

const tzHours = (a: Airport) => Math.round(a.lon / 15);
const flightMinutes = (km: number) => Math.max(40, Math.round(((km / 835) * 60 + 32) / 5) * 5);

function aircraftFor(seed: string, km: number): string {
  if (km < 1500) return pick(seed, ['Airbus A320', 'Boeing 737-800', 'Airbus A319', 'Embraer 190']);
  if (km < 5000) return pick(seed, ['Airbus A321neo', 'Boeing 737 MAX 8', 'Airbus A320neo']);
  return pick(seed, ['Boeing 787-9', 'Airbus A350-900', 'Boeing 777-300ER', 'Airbus A330-300']);
}

/** Which airlines plausibly sell this city pair, and how they route it. */
export function routingsFor(o: Airport, d: Airport): Routing[] {
  const dist = haversineKm(o, d);
  if (dist < 100) return [];
  const pairKey = [o.code, d.code].sort().join('-');
  const routings: Routing[] = [];
  const fallback: Routing[] = [];

  for (const airline of AIRLINES) {
    const home = airline.countries.includes(o.country) || airline.countries.includes(d.country);

    if (airline.kind === 'lcc') {
      const bases = airline.bases ?? airline.countries;
      const inNetwork = airline.countries.includes(o.country) && airline.countries.includes(d.country);
      const touchesBase = bases.includes(o.country) || bases.includes(d.country);
      const flies = rand(`serves:${airline.code}:${pairKey}`) < 0.72;
      if (inNetwork && touchesBase && flies && dist >= 150 && dist <= (airline.maxKm ?? 4200)) {
        routings.push({ airline, via: null, detour: 1, home: true });
      }
      continue;
    }

    // Ultra-long-haul nonstops are the preserve of a few premium and hub carriers.
    const range = airline.maxKm ?? (airline.kind === 'premium' || airline.connector ? MAX_NONSTOP_KM : 14_000);
    const atHub = airline.hubs.includes(o.code) || airline.hubs.includes(d.code);
    if (atHub && dist <= range && !(airline.longHaulOnly && dist < 3000)) {
      routings.push({ airline, via: null, detour: 1, home });
      continue;
    }

    let best: { hub: Airport; detour: number } | null = null;
    for (const code of airline.hubs) {
      const hub = getAirport(code);
      if (!hub) continue;
      const first = haversineKm(o, hub);
      const second = haversineKm(hub, d);
      if (first < MIN_LEG_KM || second < MIN_LEG_KM || first > range || second > range) continue;
      if (airline.longHaulOnly && Math.max(first, second) < 3000) continue;
      const detour = (first + second) / dist;
      if (!best || detour < best.detour) best = { hub, detour };
    }
    if (!best) continue;

    const candidate: Routing = { airline, via: best.hub, detour: best.detour, home };
    const limit = airline.connector ? 1.5 : home ? 1.45 : 1.15;
    const relevant = home || airline.connector === true || dist > 2500;
    if (relevant && best.detour <= limit) routings.push(candidate);
    else fallback.push(candidate);
  }

  // Obscure city pairs: fall back to the least roundabout connections so the
  // search never comes back empty just because the airline table is small.
  if (routings.length < 2) {
    fallback.sort((a, b) => a.detour - b.detour);
    routings.push(...fallback.filter((r) => r.detour <= 2.4).slice(0, 3 - routings.length));
  }

  const score = (r: Routing) => (r.via ? 10 : 0) + (r.home ? 0 : 3) + r.detour;
  return routings.sort((a, b) => score(a) - score(b)).slice(0, MAX_AIRLINES);
}

function buildSlice(routing: Routing, from: Airport, to: Airport, date: string, index: number, cabin: CabinClass): SlicePlan {
  const { airline, via } = routing;
  const directKm = haversineKm(from, to);
  const stops = via ? [from, via, to] : [from, to];
  const routeSeed = `${airline.code}:${from.code}:${to.code}`;

  const slot = DEPARTURE_SLOTS[(randInt(`slot:${routeSeed}`, 0, 7) + index * 3) % DEPARTURE_SLOTS.length] as number;
  const departMin = slot + randInt(`jit:${routeSeed}:${index}`, -4, 4) * 5;

  const segments: Segment[] = [];
  const layovers: Layover[] = [];
  const numbers: string[] = [];
  // `clock` is minutes after UTC midnight of `date`.
  let clock = departMin - tzHours(from) * 60;
  const start = clock;
  let flownKm = 0;

  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i] as Airport;
    const b = stops[i + 1] as Airport;
    const km = haversineKm(a, b);
    const duration = flightMinutes(km);
    const flightNumber = `${airline.code} ${randInt(`fn:${airline.code}:${a.code}:${b.code}:${index}`, 10, 2999)}`;
    const departLocal = clock + tzHours(a) * 60;
    clock += duration;
    const arriveLocal = clock + tzHours(b) * 60;
    flownKm += km;
    numbers.push(flightNumber);
    segments.push({
      flightNumber,
      airlineCode: airline.code,
      airlineName: airline.name,
      operatedBy: null,
      from: a.code,
      to: b.code,
      departAt: localStamp(date, departLocal),
      arriveAt: localStamp(date, arriveLocal),
      durationMin: duration,
      aircraft: aircraftFor(`ac:${flightNumber}`, km),
    });
    if (i < stops.length - 2) {
      const wait = randInt(`lay:${routeSeed}:${index}`, 13, 43) * 5;
      const endLocal = arriveLocal + wait;
      layovers.push({
        airport: b.code,
        durationMin: wait,
        overnight: Math.floor(arriveLocal / 1440) !== Math.floor(endLocal / 1440),
      });
      clock += wait;
    }
  }

  const key = numbers.join('+');
  const routeKey = `${from.code}-${to.code}-${date}`;
  const [, month, dayOfMonth] = date.split('-').map(Number) as [number, number, number];
  const holidayPeak = month === 12 && dayOfMonth >= 18 ? 1.12 : month === 1 && dayOfMonth <= 3 ? 1.12 : 1;
  const timeOfDay = departMin < 420 || departMin >= 1260 ? 0.94 : (departMin >= 480 && departMin < 600) || (departMin >= 960 && departMin < 1140) ? 1.04 : 1;
  const stopFactor = via ? (airline.connector || airline.kind === 'premium' ? 0.93 : 0.88) : directKm > 4000 ? 1.07 : 1;
  const staticUsd =
    (25 + 0.55 * directKm ** 0.72) *
    airline.priceIndex *
    stopFactor *
    (DOW_FACTOR[dayOfWeek(date)] as number) *
    (MONTH_FACTOR[month - 1] as number) *
    holidayPeak *
    timeOfDay *
    CABIN_MULTIPLIER[cabin];
  const saleDepth = airline.kind === 'lcc' ? 0.8 : 0.85;
  const saleOffset = rand(`saleoff:${airline.code}`);

  const priceUsd = (now: Date): number => {
    const t = now.getTime() / DAY_MS;
    const advance = interpolate(ADVANCE_CURVE, Math.max(0, daysUntil(date, now)));
    const noise =
      0.07 * valueNoise(`slow:${routeKey}`, t / 18) +
      0.045 * valueNoise(`mid:${routeKey}`, t / 5) +
      0.05 * valueNoise(`air:${airline.code}:${routeKey}`, t / 3.1) +
      0.025 * valueNoise(`flt:${key}:${date}`, t / 0.9);
    // Each airline runs a sale on a route for ~3 days in roughly one week out of seven.
    const week = t / 7 + saleOffset;
    const weekIndex = Math.floor(week);
    const saleSeed = `sale:${airline.code}:${routeKey}:${weekIndex}`;
    const saleStart = rand(`${saleSeed}:start`) * 0.5;
    const inWeek = week - weekIndex;
    const onSale = rand(saleSeed) < 0.14 && inWeek >= saleStart && inWeek <= saleStart + 0.45;
    return Math.max(19, staticUsd * advance * (1 + noise) * (onSale ? saleDepth : 1));
  };

  return {
    slice: { segments, layovers, durationMin: clock - start, stops: segments.length - 1 },
    key,
    priceUsd,
    flownKm,
  };
}

function bagRule(policy: BagPolicy, quantity: number, directions: number, currency: string): BagRule {
  if (policy === 'inc') return { status: 'included', quantity, fee: null, feeMax: null, note: null };
  return { status: 'fee', quantity: 0, fee: money(policy * directions, currency), feeMax: null, note: null };
}

function baggageFor(airline: MockAirline, longHaul: boolean, query: SearchQuery, directions: number): Baggage {
  const economy = query.cabin === 'economy';
  const premiumCabin = query.cabin === 'business' || query.cabin === 'first';
  const checkedPolicy = economy ? (longHaul ? airline.checkedLong : airline.checkedShort) : 'inc';
  return {
    carryOn: bagRule(economy ? airline.carryOn : 'inc', 1, directions, query.currency),
    checked: bagRule(checkedPolicy, premiumCabin ? 2 : (airline.includedBags ?? 1), directions, query.currency),
    source: 'simulated',
  };
}

function amenitiesFor(airline: MockAirline, cabin: CabinClass, longHaul: boolean): Amenities {
  const legroomIn = cabin === 'economy' ? airline.legroom : cabin === 'premium_economy' ? airline.legroom + 6 : null;
  return {
    legroomIn,
    legroomRating:
      cabin === 'economy' ? (airline.legroom <= 29 ? 'below' : airline.legroom >= 32 ? 'above' : 'average') : cabin === 'premium_economy' ? 'above' : null,
    wifi: airline.wifi,
    power: cabin === 'economy' ? airline.power : true,
    entertainment: airline.ife,
    seat: cabin === 'first' ? 'Individual suite' : cabin === 'business' && longHaul ? 'Lie flat seat' : null,
  };
}

function fareFor(airline: MockAirline, cabin: CabinClass): FareRules {
  if (cabin !== 'economy') {
    const brand = cabin === 'premium_economy' ? 'Premium Economy' : cabin === 'business' ? 'Business' : 'First';
    return { brand, changes: 'free', refund: 'fee', seatSelection: 'free' };
  }
  return {
    brand: airline.brand,
    changes: airline.changes,
    refund: airline.refund,
    seatSelection: airline.kind === 'lcc' || airline.changes === 'no' ? 'fee' : 'free',
  };
}

function planOffers(query: SearchQuery): OfferPlan[] {
  const origin = getAirport(query.origin);
  const destination = getAirport(query.destination);
  if (!origin) throw new ProviderError(`Unknown airport "${query.origin}"`, 400, 'unknown_airport');
  if (!destination) throw new ProviderError(`Unknown airport "${query.destination}"`, 400, 'unknown_airport');

  const directKm = haversineKm(origin, destination);
  const longHaul = directKm > 4000;
  const roundTrip = query.returnDate != null;
  const directions = roundTrip ? 2 : 1;
  const plans: OfferPlan[] = [];

  for (const routing of routingsFor(origin, destination)) {
    const { airline } = routing;
    if (query.cabin !== 'economy' && airline.kind === 'lcc') continue;
    if (query.cabin === 'first' && !(longHaul && airline.kind !== 'lcc')) continue;
    const stops = routing.via ? 1 : 0;
    if (query.maxStops != null && stops > query.maxStops) continue;

    const pairSeed = `${airline.code}:${[origin.code, destination.code].sort().join('-')}`;
    const frequency = routing.via
      ? randInt(`freq:${pairSeed}`, 1, 2)
      : airline.kind === 'lcc'
        ? randInt(`freq:${pairSeed}`, 1, 2)
        : directKm < 1500
          ? randInt(`freq:${pairSeed}`, 2, 4)
          : directKm < 5000
            ? randInt(`freq:${pairSeed}`, 1, 3)
            : randInt(`freq:${pairSeed}`, 1, 2);

    const outbound = Array.from({ length: frequency }, (_, i) => buildSlice(routing, origin, destination, query.departDate, i, query.cabin));
    const inbound = roundTrip
      ? Array.from({ length: frequency }, (_, i) => buildSlice(routing, destination, origin, query.returnDate as string, i, query.cabin))
      : [];

    const airlineRef: AirlineRef = { code: airline.code, name: airline.name, logoUrl: null };
    outbound.forEach((out, i) => {
      const back = roundTrip ? (inbound[i % inbound.length] as SlicePlan) : null;
      const flownKm = out.flownKm + (back?.flownKm ?? 0);
      const typicalKg = directKm * directions * 0.085 * CABIN_EMISSIONS[query.cabin];
      const emissionsKg = Math.round(flownKm * 0.085 * CABIN_EMISSIONS[query.cabin] * (0.93 + rand(`co2:${airline.code}:${out.key}`) * 0.16));
      const id = shortId(`${out.key}|${back?.key ?? ''}|${query.departDate}|${query.returnDate ?? ''}|${query.cabin}`);
      plans.push({
        airline: airlineRef,
        offer: {
          id,
          currency: query.currency,
          airline: airlineRef,
          airlines: [airlineRef],
          slices: back ? [out.slice, back.slice] : [out.slice],
          stops: out.slice.stops,
          durationMin: out.slice.durationMin,
          baggage: baggageFor(airline, longHaul, query, directions),
          amenities: amenitiesFor(airline, query.cabin, longHaul),
          fare: fareFor(airline, query.cabin),
          emissionsKg,
          emissionsDiffPct: Math.round((emissionsKg / typicalKg - 1) * 100),
          oftenDelayed: rand(`delay:${out.key}`) < 0.08,
          details: 'full',
          detailsCost: 0,
        },
        priceAt: (now) => {
          const usd = back ? (out.priceUsd(now) + back.priceUsd(now)) * 0.92 : out.priceUsd(now);
          return money(usd * query.adults, query.currency);
        },
      });
    });
  }
  return plans;
}

export class MockProvider implements FlightProvider {
  // The calendar reaches as far as the live source's does, so demo mode behaves the same.
  readonly info = { id: 'mock', label: 'Demo data', demo: true, costPerSearch: 0, calendarMaxDays: 180 };

  /**
   * Lowest fare per departure date. Built from the same plans as `search`, so
   * opening a date from the calendar shows the price the calendar promised.
   */
  async calendar(query: CalendarQuery, now: Date): Promise<ProviderCalendarResult> {
    const days: ProviderCalendarResult['days'] = [];
    for (let departDate = query.start; departDate <= query.end; departDate = addDays(departDate, 1)) {
      // Flights that have already left are no longer on sale.
      if (parseDate(departDate).getTime() + DAY_MS < now.getTime()) continue;
      const returnDate = query.tripDays != null ? addDays(departDate, query.tripDays) : null;
      const plans = planOffers({
        origin: query.origin,
        destination: query.destination,
        departDate,
        returnDate,
        adults: query.adults,
        cabin: query.cabin,
        currency: query.currency,
        maxStops: query.maxStops,
      });
      if (plans.length === 0) continue;
      days.push({ departDate, returnDate, price: Math.min(...plans.map((plan) => plan.priceAt(now))) });
    }
    return { days, cost: 0 };
  }

  async search(query: SearchQuery, now: Date): Promise<ProviderSearchResult> {
    // Flights that have already left are no longer on sale.
    const departed = parseDate(query.departDate).getTime() + DAY_MS < now.getTime();
    const plans = departed ? [] : planOffers(query);
    if (plans.length === 0) {
      return { offers: [], insights: null, history: [], externalUrl: null, cost: 0 };
    }

    const offers: ProviderOffer[] = plans
      .map((plan) => ({ ...plan.offer, price: plan.priceAt(now) }))
      .sort((a, b) => a.price - b.price || a.durationMin - b.durationMin);

    const history: ProviderHistoryPoint[] = [];
    for (let i = HISTORY_DAYS; i >= 1; i--) {
      const at = new Date(now.getTime() - i * DAY_MS);
      const byAirline = new Map<string, { airline: AirlineRef; price: number }>();
      let lowest = Infinity;
      for (const plan of plans) {
        const price = plan.priceAt(at);
        lowest = Math.min(lowest, price);
        const seen = byAirline.get(plan.airline.code);
        if (!seen || price < seen.price) byAirline.set(plan.airline.code, { airline: plan.airline, price });
      }
      history.push({ t: at.toISOString(), price: lowest, airlines: [...byAirline.values()] });
    }

    const lowestPrice = (offers[0] as ProviderOffer).price;
    const past = history.map((p) => p.price);
    const low = Math.round(quantile(past, 0.25) as number);
    const high = Math.max(low + 1, Math.round(quantile(past, 0.75) as number));
    return {
      offers,
      insights: {
        lowestPrice,
        level: lowestPrice < low ? 'low' : lowestPrice > high ? 'high' : 'typical',
        typicalRange: [low, high],
      },
      history,
      externalUrl: null,
      cost: 0,
    };
  }
}
