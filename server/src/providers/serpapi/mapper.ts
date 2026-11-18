// Maps SerpApi "google_flights" responses onto the app's offer model.
// Response shapes follow https://serpapi.com/google-flights-api,
// https://serpapi.com/google-flights-booking-options and
// https://serpapi.com/google-flights-calendar-api.

import type { AirlineRef, Amenities, BagRule, Baggage, FareRules, FlexDay, Layover, PriceLevel, SearchQuery, Segment, Slice } from '@shared/types';
import { shortId } from '../../lib/hash';
import type { ProviderHistoryPoint, ProviderOffer } from '../types';

export interface SerpSegment {
  departure_airport: { name?: string; id: string; time: string };
  arrival_airport: { name?: string; id: string; time: string };
  duration?: number;
  airplane?: string;
  airline?: string;
  airline_logo?: string;
  flight_number?: string;
  legroom?: string;
  extensions?: string[];
  overnight?: boolean;
  often_delayed_by_over_30_min?: boolean;
  plane_and_crew_by?: string;
}

export interface SerpItinerary {
  flights?: SerpSegment[];
  layovers?: { duration?: number; name?: string; id?: string; overnight?: boolean }[];
  total_duration?: number;
  carbon_emissions?: { this_flight?: number; typical_for_this_route?: number; difference_percent?: number };
  price?: number;
  /** "Round trip" | "One way" | "Multi-city" */
  type?: string;
  airline_logo?: string;
  extensions?: string[];
  departure_token?: string;
  booking_token?: string;
}

export interface SerpBookingChannel {
  book_with?: string;
  airline?: boolean;
  price?: number;
  option_title?: string;
  extensions?: string[];
  baggage_prices?: string[];
}

export interface SerpBookingOption {
  separate_tickets?: boolean;
  together?: SerpBookingChannel;
  departing?: SerpBookingChannel;
  returning?: SerpBookingChannel;
}

export interface SerpResponse {
  error?: string;
  search_metadata?: { google_flights_url?: string };
  best_flights?: SerpItinerary[];
  other_flights?: SerpItinerary[];
  price_insights?: {
    lowest_price?: number;
    price_level?: string;
    typical_price_range?: number[];
    price_history?: number[][];
  };
  selected_flights?: SerpItinerary[];
  baggage_prices?: { together?: string[]; departing?: string[]; returning?: string[] };
  booking_options?: SerpBookingOption[];
  /** google_flights_calendar: one entry per departure date. */
  prices?: SerpCalendarPrice[];
}

export interface SerpCalendarPrice {
  outbound_date?: string;
  /** Round trips only. */
  return_date?: string;
  price?: number;
  low_price?: boolean;
}

/** Keeps the calendar entries that carry a usable date and fare, in date order. */
export function mapCalendar(res: SerpResponse): FlexDay[] {
  const days: FlexDay[] = [];
  for (const entry of res.prices ?? []) {
    if (!entry.outbound_date || !/^\d{4}-\d{2}-\d{2}$/.test(entry.outbound_date)) continue;
    if (typeof entry.price !== 'number' || !(entry.price > 0)) continue;
    days.push({ departDate: entry.outbound_date, returnDate: entry.return_date ?? null, price: entry.price });
  }
  return days.sort((a, b) => a.departDate.localeCompare(b.departDate));
}

const UNKNOWN_BAG: BagRule = { status: 'unknown', quantity: null, fee: null, feeMax: null, note: null };

const toNumber = (raw: string) => Number(raw.replace(/,/g, ''));

/**
 * Reads Google's free-text baggage lines, e.g. "1 free carry-on",
 * "1st checked bag: 99-187", "1st checked bag up to 23 kg free",
 * "Checked baggage for a fee". Lines that are not understood are ignored.
 */
export function parseBaggageLines(lines: readonly string[]): { carryOn: BagRule; checked: BagRule } {
  let carryOn: BagRule = { ...UNKNOWN_BAG };
  let checked: BagRule = { ...UNKNOWN_BAG };

  for (const line of lines) {
    const text = line.trim();
    const isCarryOn = /carry[- ]?on/i.test(text);
    const isChecked = /checked/i.test(text);
    if (!isCarryOn && !isChecked) continue;

    let rule: BagRule;
    const price = text.match(/:\s*[^\d]{0,4}([\d][\d.,]*)(?:\s*[-–]\s*[^\d]{0,4}([\d][\d.,]*))?/);
    const leadingCount = text.match(/^(\d+)\s+free\b/i);
    if (price) {
      rule = { status: 'fee', quantity: 0, fee: toNumber(price[1] as string), feeMax: price[2] ? toNumber(price[2]) : null, note: null };
    } else if (/\bfor a fee\b|\bnot included\b|\bextra charge\b/i.test(text)) {
      rule = { status: 'fee', quantity: 0, fee: null, feeMax: null, note: null };
    } else if (/\bfree\b|\bincluded\b/i.test(text)) {
      const weight = text.match(/up to\s+(\d+\s*(?:kg|lb))/i);
      rule = {
        status: 'included',
        quantity: leadingCount ? Number(leadingCount[1]) : 1,
        fee: null,
        feeMax: null,
        note: weight ? `up to ${weight[1]}` : null,
      };
    } else {
      continue;
    }
    if (isCarryOn) carryOn = rule;
    else checked = rule;
  }
  return { carryOn, checked };
}

function addRules(a: BagRule, b: BagRule): BagRule {
  if (a.status === 'unknown' || b.status === 'unknown') {
    const fee = a.status === 'fee' || b.status === 'fee';
    return fee ? { status: 'fee', quantity: 0, fee: null, feeMax: null, note: null } : { ...UNKNOWN_BAG };
  }
  if (a.status === 'included' && b.status === 'included') {
    return { ...a, quantity: Math.min(a.quantity ?? 1, b.quantity ?? 1) };
  }
  // At least one direction charges: the itinerary fee is the sum, when every charged direction has an amount.
  const parts = [a, b].filter((r) => r.status === 'fee');
  const known = parts.every((r) => r.fee != null);
  return {
    status: 'fee',
    quantity: 0,
    fee: known ? parts.reduce((sum, r) => sum + (r.fee as number), 0) : null,
    feeMax: known && parts.some((r) => r.feeMax != null) ? parts.reduce((sum, r) => sum + (r.feeMax ?? (r.fee as number)), 0) : null,
    note: parts.length === 1 ? 'one direction only' : null,
  };
}

/** Bag rules for separately ticketed directions, combined into one itinerary-level rule. */
export function combineBaggage(
  departing: { carryOn: BagRule; checked: BagRule },
  returning: { carryOn: BagRule; checked: BagRule },
): { carryOn: BagRule; checked: BagRule } {
  return {
    carryOn: addRules(departing.carryOn, returning.carryOn),
    checked: addRules(departing.checked, returning.checked),
  };
}

function parseLegroom(raw: string | undefined): number | null {
  if (!raw) return null;
  const m = raw.match(/([\d.]+)\s*(in|cm)/i);
  if (!m) return null;
  const value = Number(m[1]);
  return Math.round((m[2] as string).toLowerCase() === 'cm' ? value / 2.54 : value);
}

export function parseAmenities(segment: SerpSegment | undefined): Amenities {
  const ext = segment?.extensions ?? [];
  const has = (re: RegExp) => ext.some((e) => re.test(e));
  const seat = ext.find((e) => /lie flat|suite|angled flat|recliner|reclining/i.test(e)) ?? null;
  return {
    legroomIn: parseLegroom(segment?.legroom),
    legroomRating: has(/below average legroom/i) ? 'below' : has(/above average legroom/i) ? 'above' : has(/average legroom/i) ? 'average' : null,
    wifi: has(/free wi-?fi/i) ? 'free' : has(/wi-?fi/i) ? 'paid' : null,
    power: has(/power|usb/i) ? true : null,
    entertainment: has(/video|stream media|live tv|entertainment/i) ? true : null,
    seat,
  };
}

/** "2026-03-03 10:10" -> "2026-03-03T10:10" */
const stamp = (time: string) => time.trim().replace(' ', 'T').slice(0, 16);

function splitFlightNumber(raw: string | undefined): { code: string; label: string } {
  const text = (raw ?? '').trim();
  const m = text.match(/^([A-Z0-9]{2})\s*(\d+[A-Z]?)$/i);
  if (!m) return { code: text.slice(0, 2).toUpperCase() || '??', label: text || 'Unknown' };
  return { code: (m[1] as string).toUpperCase(), label: `${(m[1] as string).toUpperCase()} ${m[2]}` };
}

export function mapSlice(it: SerpItinerary): { slice: Slice; airlines: AirlineRef[]; key: string } | null {
  const flights = it.flights ?? [];
  if (flights.length === 0) return null;
  const airlines = new Map<string, AirlineRef>();
  const segments: Segment[] = flights.map((f) => {
    const { code, label } = splitFlightNumber(f.flight_number);
    const name = f.airline?.trim() || code;
    if (!airlines.has(code)) airlines.set(code, { code, name, logoUrl: f.airline_logo ?? null });
    return {
      flightNumber: label,
      airlineCode: code,
      airlineName: name,
      operatedBy: f.plane_and_crew_by?.trim() || null,
      from: f.departure_airport.id,
      to: f.arrival_airport.id,
      departAt: stamp(f.departure_airport.time),
      arriveAt: stamp(f.arrival_airport.time),
      durationMin: f.duration ?? 0,
      aircraft: f.airplane?.trim() || null,
    };
  });
  const layovers: Layover[] = (it.layovers ?? []).map((l, i) => ({
    airport: l.id ?? (segments[i]?.to as string),
    durationMin: l.duration ?? 0,
    overnight: l.overnight === true,
  }));
  const durationMin = it.total_duration ?? segments.reduce((sum, s) => sum + s.durationMin, 0) + layovers.reduce((sum, l) => sum + l.durationMin, 0);
  return {
    slice: { segments, layovers, durationMin, stops: segments.length - 1 },
    airlines: [...airlines.values()],
    key: segments.map((s) => `${s.flightNumber}@${s.departAt}`).join('+'),
  };
}

/** One search result row -> offer. Returns null for rows without a price or flights. */
export function mapItinerary(it: SerpItinerary, query: SearchQuery): ProviderOffer | null {
  if (typeof it.price !== 'number' || !Number.isFinite(it.price)) return null;
  const mapped = mapSlice(it);
  if (!mapped) return null;
  const { slice, airlines, key } = mapped;
  const flights = it.flights ?? [];
  const longest = [...flights].sort((a, b) => (b.duration ?? 0) - (a.duration ?? 0))[0];
  const token = query.returnDate ? it.departure_token : it.booking_token;

  const ref: Record<string, string> = {};
  if (it.booking_token) ref.bookingToken = it.booking_token;
  if (it.departure_token) ref.departureToken = it.departure_token;

  const emissions = it.carbon_emissions;
  return {
    id: shortId(`${key}|${query.returnDate ?? ''}|${query.cabin}`),
    price: it.price,
    currency: query.currency,
    airline: airlines[0] as AirlineRef,
    airlines,
    slices: [slice],
    stops: slice.stops,
    durationMin: slice.durationMin,
    baggage: { ...parseBaggageLines(it.extensions ?? []), source: 'search' },
    amenities: parseAmenities(longest),
    fare: { brand: null, changes: null, refund: null, seatSelection: null },
    emissionsKg: typeof emissions?.this_flight === 'number' ? Math.round(emissions.this_flight / 1000) : null,
    emissionsDiffPct: typeof emissions?.difference_percent === 'number' ? emissions.difference_percent : null,
    oftenDelayed: flights.some((f) => f.often_delayed_by_over_30_min === true),
    details: token ? 'available' : 'none',
    // A round trip needs one extra search to pick the return flight before booking options can be read.
    detailsCost: token ? (query.returnDate ? 2 : 1) : 0,
    ref,
  };
}

export function mapOffers(res: SerpResponse, query: SearchQuery): ProviderOffer[] {
  const seen = new Set<string>();
  const offers: ProviderOffer[] = [];
  for (const it of [...(res.best_flights ?? []), ...(res.other_flights ?? [])]) {
    const offer = mapItinerary(it, query);
    if (!offer || seen.has(offer.id)) continue;
    seen.add(offer.id);
    offers.push(offer);
  }
  return offers.sort((a, b) => a.price - b.price || a.durationMin - b.durationMin);
}

export function mapInsights(res: SerpResponse): {
  insights: { lowestPrice: number | null; level: PriceLevel | null; typicalRange: [number, number] | null } | null;
  history: ProviderHistoryPoint[];
} {
  const pi = res.price_insights;
  if (!pi) return { insights: null, history: [] };
  const level = pi.price_level?.toLowerCase();
  const range = pi.typical_price_range;
  const history = (pi.price_history ?? [])
    .filter((p): p is [number, number] => p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]))
    .map(([seconds, price]) => ({ t: new Date(seconds * 1000).toISOString(), price }))
    .sort((a, b) => a.t.localeCompare(b.t));
  return {
    insights: {
      lowestPrice: typeof pi.lowest_price === 'number' ? pi.lowest_price : null,
      level: level === 'low' || level === 'typical' || level === 'high' ? level : null,
      typicalRange: range && range.length >= 2 ? [range[0] as number, range[1] as number] : null,
    },
    history,
  };
}

function flex(lines: readonly string[], subject: RegExp): 'free' | 'fee' | 'no' | null {
  const line = lines.find((l) => subject.test(l));
  if (!line) return null;
  if (/^no\b|non-?refundable|not allowed|not permitted/i.test(line)) return 'no';
  if (/for a fee|fee applies|\bfee\b/i.test(line) && !/no fee|without (a )?fee/i.test(line)) return 'fee';
  return 'free';
}

export function parseFareRules(channel: SerpBookingChannel | undefined): FareRules {
  const lines = channel?.extensions ?? [];
  const seat = flex(lines, /seat selection|choose (your )?seat/i);
  return {
    brand: channel?.option_title?.trim() || null,
    changes: flex(lines, /change/i),
    refund: flex(lines, /refund/i),
    seatSelection: seat === 'no' ? null : seat,
  };
}

/**
 * Applies a booking-options response to an offer: bag fees, fare brand and
 * rules of the cheapest way to book, plus the return slice on round trips.
 */
export function applyBookingDetails(offer: ProviderOffer, res: SerpResponse): ProviderOffer {
  const options = [...(res.booking_options ?? [])].sort(
    (a, b) => (a.together?.price ?? a.departing?.price ?? Infinity) - (b.together?.price ?? b.departing?.price ?? Infinity),
  );
  const best = options[0];
  const top = res.baggage_prices ?? {};

  let rules: { carryOn: BagRule; checked: BagRule } | null = null;
  const together = best?.together?.baggage_prices ?? top.together;
  if (together?.length) {
    rules = parseBaggageLines(together);
  } else {
    const departing = best?.departing?.baggage_prices ?? top.departing;
    const returning = best?.returning?.baggage_prices ?? top.returning;
    if (departing?.length && returning?.length) rules = combineBaggage(parseBaggageLines(departing), parseBaggageLines(returning));
    else if (departing?.length) rules = parseBaggageLines(departing);
  }

  const baggage: Baggage = rules
    ? {
        // Keep what the search already said when the booking page is silent on one bag type.
        carryOn: rules.carryOn.status === 'unknown' ? offer.baggage.carryOn : rules.carryOn,
        checked: rules.checked.status === 'unknown' ? offer.baggage.checked : rules.checked,
        source: 'fare_details',
      }
    : offer.baggage;

  const slices = (res.selected_flights ?? []).map(mapSlice).filter((s) => s != null);
  const airlines = new Map(offer.airlines.map((a) => [a.code, a]));
  for (const s of slices) for (const a of s.airlines) if (!airlines.has(a.code)) airlines.set(a.code, a);

  return {
    ...offer,
    baggage,
    fare: parseFareRules(best?.together ?? best?.departing),
    slices: slices.length >= offer.slices.length ? slices.map((s) => s.slice) : offer.slices,
    airlines: [...airlines.values()],
    details: 'full',
    detailsCost: 0,
  };
}
