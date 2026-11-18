// Types shared by the API server and the web app. Keep this file free of runtime
// dependencies: both sides import it through the `@shared/*` alias.

export const CABINS = ['economy', 'premium_economy', 'business', 'first'] as const;
export type CabinClass = (typeof CABINS)[number];

export const CABIN_LABELS: Record<CabinClass, string> = {
  economy: 'Economy',
  premium_economy: 'Premium economy',
  business: 'Business',
  first: 'First',
};

export const CURRENCIES = [
  'USD', 'EUR', 'GBP', 'CAD', 'AUD', 'NZD', 'SGD', 'HKD', 'JPY', 'CNY',
  'KRW', 'INR', 'THB', 'AED', 'CHF', 'SEK', 'MXN', 'BRL',
] as const;

export interface Airport {
  code: string;
  name: string;
  city: string;
  /** ISO 3166-1 alpha-2 */
  country: string;
  lat: number;
  lon: number;
}

export interface SearchQuery {
  origin: string;
  destination: string;
  /** YYYY-MM-DD */
  departDate: string;
  /** YYYY-MM-DD, or null for one-way */
  returnDate: string | null;
  adults: number;
  cabin: CabinClass;
  currency: string;
  /** null = any number of stops */
  maxStops: number | null;
}

/**
 * A search with no fixed dates: every departure date in the coming window.
 * This is how "tell me when a cheap fare shows up, whenever it is" is expressed.
 */
export interface FlexQuery {
  origin: string;
  destination: string;
  /** Days between the outbound and the return flight; null for one-way. */
  tripDays: number | null;
  /** How far ahead to look, in days from today (never beyond what the provider's calendar reaches). */
  windowDays: number;
  adults: number;
  cabin: CabinClass;
  currency: string;
  /** null = any number of stops */
  maxStops: number | null;
}

/**
 * How far ahead a flexible search can look. Airlines sell about 11 months out,
 * but Google Flights' date calendar, the source of these searches, only prices
 * roughly the next six months.
 */
export const FLEX_WINDOWS = [
  { days: 30, label: '1 month' },
  { days: 90, label: '3 months' },
  { days: 180, label: '6 months' },
] as const;
export const FLEX_MAX_WINDOW_DAYS = 180;
export const FLEX_DEFAULT_WINDOW_DAYS = 180;
export const FLEX_MAX_TRIP_DAYS = 60;

/** Provider searches one scan of a flexible trip costs: a single calendar request. */
export function flexScanCost(provider: Pick<ProviderInfo, 'costPerSearch' | 'calendarMaxDays'>): number {
  return provider.calendarMaxDays ? provider.costPerSearch : 0;
}

export interface AirlineRef {
  code: string;
  name: string;
  logoUrl: string | null;
}

export interface Segment {
  flightNumber: string;
  airlineCode: string;
  airlineName: string;
  operatedBy: string | null;
  from: string;
  to: string;
  /** Local time at the departure airport, "YYYY-MM-DDTHH:mm" */
  departAt: string;
  /** Local time at the arrival airport, "YYYY-MM-DDTHH:mm" */
  arriveAt: string;
  durationMin: number;
  aircraft: string | null;
}

export interface Layover {
  airport: string;
  durationMin: number;
  overnight: boolean;
}

/** One direction of travel (outbound or return). */
export interface Slice {
  segments: Segment[];
  layovers: Layover[];
  durationMin: number;
  stops: number;
}

export type BagStatus = 'included' | 'fee' | 'unknown';

export interface BagRule {
  status: BagStatus;
  /** Number of bags included in the fare (when status is "included"). */
  quantity: number | null;
  /**
   * Fee for the first bag, per traveller, for the whole itinerary as priced
   * (both directions on a round trip). Null when the amount is not known.
   */
  fee: number | null;
  /** Upper bound when the provider reports a fee range. */
  feeMax: number | null;
  note: string | null;
}

export interface Baggage {
  carryOn: BagRule;
  checked: BagRule;
  /** Where the baggage data came from. */
  source: 'search' | 'fare_details' | 'simulated';
}

export interface Amenities {
  legroomIn: number | null;
  legroomRating: 'below' | 'average' | 'above' | null;
  wifi: 'free' | 'paid' | 'none' | null;
  power: boolean | null;
  entertainment: boolean | null;
  /** Special seat type, e.g. "Lie flat seat". */
  seat: string | null;
}

export type FareFlex = 'free' | 'fee' | 'no';

export interface FareRules {
  /** Fare brand, e.g. "Basic Economy". */
  brand: string | null;
  changes: FareFlex | null;
  refund: FareFlex | null;
  seatSelection: 'free' | 'fee' | null;
}

export interface FlightOffer {
  /** Stable across checks for the same flights on the same dates. */
  id: string;
  /** Total for all travellers, in `currency`. */
  price: number;
  currency: string;
  /** Marketing carrier of the first outbound segment. */
  airline: AirlineRef;
  airlines: AirlineRef[];
  /** [outbound] or [outbound, return]. On round trips some providers only return the outbound. */
  slices: Slice[];
  /** Stops and duration of the outbound slice. */
  stops: number;
  durationMin: number;
  baggage: Baggage;
  amenities: Amenities;
  fare: FareRules;
  emissionsKg: number | null;
  /** Percent difference vs. typical emissions for the route. */
  emissionsDiffPct: number | null;
  oftenDelayed: boolean;
  /** "full": nothing more to load. "available": fare + bag fees can be loaded on demand. */
  details: 'full' | 'available' | 'none';
  /** Provider searches consumed by loading details. */
  detailsCost: number;
}

export interface PricePoint {
  /** ISO timestamp */
  t: string;
  price: number;
}

export type PriceLevel = 'low' | 'typical' | 'high';

export interface PriceInsights {
  lowestPrice: number | null;
  level: PriceLevel | null;
  typicalRange: [number, number] | null;
  /** Lowest price for this itinerary over time, oldest first. */
  history: PricePoint[];
}

export interface ProviderInfo {
  id: string;
  label: string;
  /** True when prices are simulated rather than real fares. */
  demo: boolean;
  /** Provider searches consumed by one flight search (0 = free). */
  costPerSearch: number;
  /**
   * How many days ahead the provider's date calendar reaches. One request,
   * costing `costPerSearch`, prices all of them. Null when the provider cannot
   * search flexible dates.
   */
  calendarMaxDays: number | null;
}

export interface SearchResult {
  query: SearchQuery;
  provider: ProviderInfo;
  fetchedAt: string;
  cached: boolean;
  offers: FlightOffer[];
  insights: PriceInsights | null;
  /** Airports referenced by the query and the offers. */
  airports: Record<string, Airport>;
  /** Link to the same search on the provider's site, when available. */
  externalUrl: string | null;
}

export interface CalendarDay {
  departDate: string;
  returnDate: string | null;
  /** Null when there were no offers or the day was not fetched. */
  minPrice: number | null;
  airline: AirlineRef | null;
  fetched: boolean;
}

export interface CalendarResult {
  days: CalendarDay[];
  currency: string;
  searchesUsed: number;
  /** Set when the scan stopped early (e.g. the search budget ran out). */
  notice: string | null;
}

/** Lowest fare for one departure date of a flexible search. */
export interface FlexDay {
  departDate: string;
  /** Null for one-way. */
  returnDate: string | null;
  price: number;
}

export interface FlexMonth {
  /** YYYY-MM */
  month: string;
  cheapest: FlexDay;
  /** Priced departure dates in this month. */
  days: number;
  median: number;
  /**
   * Change in the month's cheapest fare since the previous scan, compared over
   * the dates both scans cover. Null without an earlier scan.
   */
  change: number | null;
}

export interface FlexResult {
  query: FlexQuery;
  provider: ProviderInfo;
  fetchedAt: string;
  cached: boolean;
  /** First and last departure date searched. */
  range: { start: string; end: string };
  /** One entry per departure date that has a fare, in date order. */
  days: FlexDay[];
  cheapest: FlexDay | null;
  months: FlexMonth[];
  searchesUsed: number;
  airports: Record<string, Airport>;
}

export interface Usage {
  month: string;
  used: number;
  /** Null = unlimited. */
  budget: number | null;
}

export interface Meta {
  provider: ProviderInfo;
  usage: Usage;
  defaultCheckIntervalHours: number;
  /** Estimated provider searches per month for the currently active watches. */
  projectedMonthlySearches: number;
}

export type WatchKind = 'fixed' | 'flex';

export interface Watch {
  id: number;
  /** "fixed": one itinerary on set dates. "flex": every date in a rolling window. */
  kind: WatchKind;
  /**
   * The tracked trip. For a flexible watch the dates are the cheapest ones the
   * latest scan found (departDate is "" until a scan has found a fare).
   */
  query: SearchQuery;
  /** Set for flexible watches only. */
  flex: { tripDays: number | null; windowDays: number } | null;
  targetPrice: number | null;
  active: boolean;
  checkIntervalHours: number;
  createdAt: string;
  lastCheckedAt: string | null;
  nextCheckAt: string | null;
  lastError: string | null;
}

export interface WatchSummary extends Watch {
  originAirport: Airport | null;
  destinationAirport: Airport | null;
  /** True once the departure date has passed; expired watches are no longer checked. */
  expired: boolean;
  currentPrice: number | null;
  previousPrice: number | null;
  lowestPrice: number | null;
  highestPrice: number | null;
  averagePrice: number | null;
  level: PriceLevel | null;
  cheapestAirline: AirlineRef | null;
  observations: number;
  spark: PricePoint[];
  unreadAlerts: number;
}

export interface HistoryPoint extends PricePoint {
  /** "check": observed by this app. "history": back-filled from the provider's price history. */
  source: 'check' | 'history';
}

export interface AirlineSeries {
  airline: AirlineRef;
  points: PricePoint[];
  latestPrice: number | null;
}

export interface PriceStats {
  current: number | null;
  lowest: number | null;
  lowestAt: string | null;
  highest: number | null;
  average: number | null;
  median: number | null;
  /** Share (0-100) of past observations that were more expensive than the current price. */
  cheaperThanPct: number | null;
  change24h: number | null;
  change7d: number | null;
  observations: number;
  spanDays: number;
}

export type VerdictKind = 'buy' | 'fair' | 'wait' | 'unknown';

export interface Verdict {
  kind: VerdictKind;
  headline: string;
  reasons: string[];
}

export type AlertKind = 'target_hit' | 'new_low' | 'price_drop';

export interface Alert {
  id: number;
  watchId: number;
  kind: AlertKind;
  price: number;
  previousPrice: number | null;
  currency: string;
  message: string;
  createdAt: string;
  readAt: string | null;
  /** For a flexible trip the dates are the ones this alert is about ("" when it names none). */
  route: { origin: string; destination: string; departDate: string; returnDate: string | null; flexible: boolean };
}

/** Cheapest fare for one departure month over successive scans of a flexible trip. */
export interface MonthSeries {
  /** YYYY-MM */
  month: string;
  points: PricePoint[];
  latestPrice: number | null;
}

/** The latest scan of a flexible trip. */
export interface WatchCalendar {
  scannedAt: string;
  range: { start: string; end: string };
  days: FlexDay[];
  months: FlexMonth[];
  monthSeries: MonthSeries[];
  /** Provider searches one scan costs. */
  scanCost: number;
}

export interface WatchDetail {
  watch: WatchSummary;
  history: HistoryPoint[];
  airlineSeries: AirlineSeries[];
  typicalRange: [number, number] | null;
  latest: { offers: FlightOffer[]; fetchedAt: string; airports: Record<string, Airport>; externalUrl: string | null } | null;
  stats: PriceStats;
  verdict: Verdict;
  alerts: Alert[];
  provider: ProviderInfo;
  /** Present for flexible trips that have been scanned at least once. */
  calendar: WatchCalendar | null;
}

/** Exactly one of `query` (fixed dates) and `flex` (any dates) is given. */
export interface CreateWatchInput {
  query?: SearchQuery;
  flex?: FlexQuery;
  targetPrice?: number | null;
  checkIntervalHours?: number;
}

export interface UpdateWatchInput {
  targetPrice?: number | null;
  active?: boolean;
  checkIntervalHours?: number;
}

export interface ApiError {
  error: string;
  code?: string;
}
