import type { CabinClass, SearchQuery } from '@shared/types';
import {
  ProviderError,
  type CalendarQuery,
  type FlightProvider,
  type ProviderCalendarResult,
  type ProviderOffer,
  type ProviderSearchResult,
} from '../types';
import { applyBookingDetails, mapCalendar, mapInsights, mapOffers, type SerpResponse } from './mapper';

const ENDPOINT = 'https://serpapi.com/search.json';
const TRAVEL_CLASS: Record<CabinClass, string> = { economy: '1', premium_economy: '2', business: '3', first: '4' };
/**
 * How far ahead the calendar is asked for. Checked against the live API in
 * November 2026: a range ending 183 days out comes back complete, while one
 * that ends 270 days out, or starts 184 days out, comes back empty. So the
 * limit is how far ahead Google's calendar reaches, not the length of the
 * range, and overshooting it loses everything. 180 leaves a little margin.
 */
const CALENDAR_MAX_DAYS = 180;

export interface SerpApiOptions {
  apiKey: string;
  gl: string;
  deepSearch: boolean;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export class SerpApiProvider implements FlightProvider {
  readonly info = { id: 'serpapi', label: 'Google Flights via SerpApi', demo: false, costPerSearch: 1, calendarMaxDays: CALENDAR_MAX_DAYS };
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: SerpApiOptions) {
    this.fetchImpl = options.fetch ?? fetch;
  }

  /** Query parameters shared by the search and its follow-up (token) requests. */
  private baseParams(query: SearchQuery): Record<string, string> {
    const params: Record<string, string> = {
      engine: 'google_flights',
      departure_id: query.origin,
      arrival_id: query.destination,
      outbound_date: query.departDate,
      type: query.returnDate ? '1' : '2',
      travel_class: TRAVEL_CLASS[query.cabin],
      adults: String(query.adults),
      currency: query.currency,
      hl: 'en',
      gl: this.options.gl,
    };
    if (query.returnDate) params.return_date = query.returnDate;
    return params;
  }

  private async request(params: Record<string, string>): Promise<SerpResponse> {
    const url = new URL(ENDPOINT);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    url.searchParams.set('api_key', this.options.apiKey);

    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 60_000),
      });
    } catch (err) {
      // Never surface the request URL: it contains the API key.
      const reason = err instanceof Error && err.name === 'TimeoutError' ? 'timed out' : 'could not be reached';
      throw new ProviderError(`SerpApi ${reason}`, 504, 'provider_unreachable');
    }

    let body: SerpResponse;
    try {
      body = (await res.json()) as SerpResponse;
    } catch {
      throw new ProviderError(`SerpApi returned an unreadable response (HTTP ${res.status})`);
    }

    if (body.error) {
      // An empty result set is reported as an error; treat it as "no flights".
      if (/hasn't returned any results|no results/i.test(body.error)) return { best_flights: [], other_flights: [] };
      if (res.status === 401) throw new ProviderError('SerpApi rejected the API key. Check SERPAPI_KEY.', 502, 'provider_auth');
      if (res.status === 429) throw new ProviderError(`SerpApi limit reached: ${body.error}`, 429, 'provider_limit');
      throw new ProviderError(`SerpApi: ${body.error}`, res.status >= 400 && res.status < 500 ? 400 : 502);
    }
    if (!res.ok) throw new ProviderError(`SerpApi request failed (HTTP ${res.status})`);
    return body;
  }

  async search(query: SearchQuery): Promise<ProviderSearchResult> {
    const params = this.baseParams(query);
    if (query.maxStops != null) params.stops = String(query.maxStops + 1); // 1 = nonstop, 2 = up to 1 stop, ...
    if (this.options.deepSearch) params.deep_search = 'true';

    const res = await this.request(params);
    const { insights, history } = mapInsights(res);
    return {
      offers: mapOffers(res, query),
      insights,
      history,
      externalUrl: res.search_metadata?.google_flights_url ?? null,
      cost: 1,
    };
  }

  /** Google Flights' date calendar: the lowest fare for each departure date in the range. */
  async calendar(query: CalendarQuery): Promise<ProviderCalendarResult> {
    const params: Record<string, string> = {
      engine: 'google_flights_calendar',
      departure_id: query.origin,
      arrival_id: query.destination,
      type: query.tripDays != null ? '1' : '2',
      date_range_start: query.start,
      date_range_end: query.end,
      travel_class: TRAVEL_CLASS[query.cabin],
      adults: String(query.adults),
      currency: query.currency,
      hl: 'en',
      gl: this.options.gl,
    };
    if (query.tripDays != null) params.round_trip_days = String(query.tripDays);
    if (query.maxStops != null) params.stops = String(query.maxStops + 1);
    return { days: mapCalendar(await this.request(params)), cost: 1 };
  }

  async loadDetails(query: SearchQuery, offer: ProviderOffer): Promise<{ offer: ProviderOffer; cost: number }> {
    let cost = 0;
    let bookingToken = query.returnDate ? undefined : offer.ref?.bookingToken;

    if (query.returnDate) {
      // Round trip: choose the cheapest return for this outbound, which is the
      // combination the search price refers to, and read its booking token.
      const departureToken = offer.ref?.departureToken;
      if (!departureToken) throw new ProviderError('Fare details are not available for this flight', 404, 'no_details');
      const returns = await this.request({ ...this.baseParams(query), departure_token: departureToken });
      cost += 1;
      const cheapest = [...(returns.best_flights ?? []), ...(returns.other_flights ?? [])]
        .filter((it) => it.booking_token)
        .sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity))[0];
      bookingToken = cheapest?.booking_token;
    }

    if (!bookingToken) throw new ProviderError('Fare details are not available for this flight', 404, 'no_details');
    const booking = await this.request({ ...this.baseParams(query), booking_token: bookingToken });
    cost += 1;
    return { offer: applyBookingDetails(offer, booking), cost };
  }
}
