import type { FlexQuery, FlightOffer, SearchQuery } from '@shared/types';
import type { Config } from '../src/config';
import type { Ctx } from '../src/context';
import { openDatabase } from '../src/db';
import { addDays } from '../src/lib/dates';
import type { CalendarQuery, FlightProvider, ProviderCalendarResult, ProviderHistoryPoint, ProviderOffer, ProviderSearchResult } from '../src/providers/types';

export const baseConfig: Config = {
  port: 0,
  host: '127.0.0.1',
  databasePath: ':memory:',
  webDist: '/nonexistent',
  serveWeb: false,
  provider: 'mock',
  serpapi: { apiKey: null, monthlyBudget: 250, gl: 'us', deepSearch: false },
  checkIntervalHours: 6,
  cacheMinutes: 10,
  dropAlertPct: 5,
  schedulerEnabled: false,
};

export const query: SearchQuery = {
  origin: 'JFK',
  destination: 'LHR',
  departDate: '2027-01-20',
  returnDate: '2027-01-27',
  adults: 1,
  cabin: 'economy',
  currency: 'USD',
  maxStops: null,
};

export const flex: FlexQuery = {
  origin: 'JFK',
  destination: 'LHR',
  tripDays: 7,
  windowDays: 180,
  adults: 1,
  cabin: 'economy',
  currency: 'USD',
  maxStops: null,
};

export function offer(id: string, price: number, airlineCode = 'BA', overrides: Partial<FlightOffer> = {}): ProviderOffer {
  const airline = { code: airlineCode, name: `Airline ${airlineCode}`, logoUrl: null };
  return {
    id,
    price,
    currency: 'USD',
    airline,
    airlines: [airline],
    slices: [
      {
        segments: [
          {
            flightNumber: `${airlineCode} 1`, airlineCode, airlineName: airline.name, operatedBy: null,
            from: 'JFK', to: 'LHR', departAt: '2027-01-20T18:00', arriveAt: '2027-01-21T06:00', durationMin: 420, aircraft: null,
          },
        ],
        layovers: [],
        durationMin: 420,
        stops: 0,
      },
    ],
    stops: 0,
    durationMin: 420,
    baggage: {
      carryOn: { status: 'included', quantity: 1, fee: null, feeMax: null, note: null },
      checked: { status: 'fee', quantity: 0, fee: 60, feeMax: null, note: null },
      source: 'simulated',
    },
    amenities: { legroomIn: 31, legroomRating: 'average', wifi: 'paid', power: true, entertainment: true, seat: null },
    fare: { brand: 'Basic', changes: 'fee', refund: 'no', seatSelection: 'fee' },
    emissionsKg: 500,
    emissionsDiffPct: 0,
    oftenDelayed: false,
    details: 'full',
    detailsCost: 0,
    ...overrides,
  };
}

/** A provider that answers each search from a script, so tests control exactly what "the market" does. */
export class ScriptedProvider implements FlightProvider {
  readonly info: FlightProvider['info'];
  calls = 0;
  history: ProviderHistoryPoint[] = [];
  loadDetails?: FlightProvider['loadDetails'];
  private queue: (ProviderOffer[] | Error)[] = [];
  private fallback: ProviderOffer[] = [];

  /** Every calendar request made, in order. */
  calendarCalls: CalendarQuery[] = [];
  /** Fare for a departure date in calendar requests; null = no flights that day. Tests replace it to move the market. */
  fare: (departDate: string) => number | null = () => 300;
  /** When set, the next calendar request fails with it. */
  calendarError: Error | null = null;

  constructor(
    private readonly cost = 0,
    calendarMaxDays: number | null = 180,
  ) {
    this.info = { id: cost > 0 ? 'paid-test' : 'test', label: 'Test provider', demo: cost === 0, costPerSearch: cost, calendarMaxDays };
  }

  async calendar(query: CalendarQuery): Promise<ProviderCalendarResult> {
    this.calendarCalls.push(query);
    if (this.calendarError) {
      const error = this.calendarError;
      this.calendarError = null;
      throw error;
    }
    const days: ProviderCalendarResult['days'] = [];
    for (let date = query.start; date <= query.end; date = addDays(date, 1)) {
      const price = this.fare(date);
      if (price != null) days.push({ departDate: date, returnDate: query.tripDays != null ? addDays(date, query.tripDays) : null, price });
    }
    return { days, cost: this.cost };
  }

  /** Queue the lowest prices (or failures) successive searches will see. */
  next(...steps: (ProviderOffer[] | Error)[]): this {
    this.queue.push(...steps);
    return this;
  }

  async search(): Promise<ProviderSearchResult> {
    this.calls++;
    const step = this.queue.shift() ?? this.fallback;
    if (step instanceof Error) throw step;
    this.fallback = step;
    const lowest = step.length ? Math.min(...step.map((o) => o.price)) : null;
    return {
      offers: step,
      insights: lowest == null ? null : { lowestPrice: lowest, level: 'typical', typicalRange: [400, 500] },
      history: this.history,
      externalUrl: null,
      cost: this.cost,
    };
  }
}

export function makeCtx(provider: FlightProvider, start = '2026-11-18T12:00:00Z', config: Partial<Config> = {}): Ctx & { advance(hours: number): void } {
  let now = new Date(start).getTime();
  return {
    db: openDatabase(':memory:'),
    provider,
    config: { ...baseConfig, ...config },
    now: () => new Date(now),
    advance(hours: number) {
      now += hours * 3_600_000;
    },
  };
}
