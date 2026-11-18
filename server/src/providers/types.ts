import type { AirlineRef, CabinClass, FlexDay, FlightOffer, PriceInsights, ProviderInfo, SearchQuery } from '@shared/types';

/** An offer plus provider-private handles (booking tokens etc.) that never leave the server. */
export interface ProviderOffer extends FlightOffer {
  ref?: Record<string, string>;
}

export interface ProviderHistoryPoint {
  t: string;
  price: number;
  /** Cheapest price per airline at that time, when the provider can tell. */
  airlines?: { airline: AirlineRef; price: number }[];
}

export interface ProviderSearchResult {
  offers: ProviderOffer[];
  /** Price level and typical range; `history` here is ignored in favour of the field below. */
  insights: Omit<PriceInsights, 'history'> | null;
  history: ProviderHistoryPoint[];
  externalUrl: string | null;
  /** Provider searches consumed by this call. */
  cost: number;
}

/** Lowest fare per departure date, for every date from `start` to `end` inclusive. */
export interface CalendarQuery {
  origin: string;
  destination: string;
  start: string;
  end: string;
  /** Days between outbound and return; null for one-way. */
  tripDays: number | null;
  adults: number;
  cabin: CabinClass;
  currency: string;
  maxStops: number | null;
}

export interface ProviderCalendarResult {
  /** Dates without a fare are simply absent. */
  days: FlexDay[];
  /** Provider searches consumed by this call. */
  cost: number;
}

export interface FlightProvider {
  readonly info: ProviderInfo;
  search(query: SearchQuery, now: Date): Promise<ProviderSearchResult>;
  /**
   * Prices a whole range of departure dates in one request. The range never
   * ends more than `info.calendarMaxDays` days from today. Absent when
   * `calendarMaxDays` is null.
   */
  calendar?(query: CalendarQuery, now: Date): Promise<ProviderCalendarResult>;
  /** Loads fare rules and bag fees for one offer, for providers that do not return them with the search. */
  loadDetails?(query: SearchQuery, offer: ProviderOffer): Promise<{ offer: ProviderOffer; cost: number }>;
}

/** Raised for upstream failures that should be shown to the user as-is. */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status = 502,
    readonly code = 'provider_error',
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export function publicOffer(offer: ProviderOffer): FlightOffer {
  const { ref: _ref, ...rest } = offer;
  return rest;
}
