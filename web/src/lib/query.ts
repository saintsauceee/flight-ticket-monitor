import {
  CABINS,
  FLEX_DEFAULT_WINDOW_DAYS,
  FLEX_MAX_TRIP_DAYS,
  FLEX_MAX_WINDOW_DAYS,
  type CabinClass,
  type FlexQuery,
  type SearchQuery,
  type Watch,
} from '@shared/types';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CODE = /^[A-Z]{3}$/;

/** The parts of a search that do not depend on how its dates are given. */
function tripFromParams(params: URLSearchParams, fallbackCurrency: string) {
  const origin = (params.get('from') ?? '').toUpperCase();
  const destination = (params.get('to') ?? '').toUpperCase();
  if (!CODE.test(origin) || !CODE.test(destination)) return null;

  const cabin = params.get('cabin') as CabinClass | null;
  const stops = params.get('stops');
  const adults = Number(params.get('adults') ?? 1);
  const currency = (params.get('cur') ?? fallbackCurrency).toUpperCase();
  return {
    origin,
    destination,
    adults: Number.isInteger(adults) && adults >= 1 && adults <= 9 ? adults : 1,
    cabin: cabin && CABINS.includes(cabin) ? cabin : ('economy' as CabinClass),
    currency: CODE.test(currency) ? currency : fallbackCurrency,
    maxStops: stops === '0' || stops === '1' || stops === '2' ? Number(stops) : null,
  };
}

function tripParams(q: Pick<SearchQuery, 'origin' | 'destination'>): URLSearchParams {
  return new URLSearchParams({ from: q.origin, to: q.destination });
}

function addTripOptions(params: URLSearchParams, q: Pick<SearchQuery, 'adults' | 'cabin' | 'maxStops' | 'currency'>): URLSearchParams {
  if (q.adults !== 1) params.set('adults', String(q.adults));
  if (q.cabin !== 'economy') params.set('cabin', q.cabin);
  if (q.maxStops != null) params.set('stops', String(q.maxStops));
  params.set('cur', q.currency);
  return params;
}

/** Reads a search from the page URL (?from=JFK&to=LHR&depart=...). Null when it is incomplete. */
export function queryFromParams(params: URLSearchParams, fallbackCurrency: string): SearchQuery | null {
  const trip = tripFromParams(params, fallbackCurrency);
  const departDate = params.get('depart') ?? '';
  const returnDate = params.get('return');
  if (!trip || !DATE.test(departDate)) return null;
  return { ...trip, departDate, returnDate: returnDate && DATE.test(returnDate) ? returnDate : null };
}

export function paramsFromQuery(q: SearchQuery): URLSearchParams {
  const params = tripParams(q);
  params.set('depart', q.departDate);
  if (q.returnDate) params.set('return', q.returnDate);
  return addTripOptions(params, q);
}

export function searchPath(q: SearchQuery): string {
  return `/?${paramsFromQuery(q).toString()}`;
}

/** Reads a flexible-date search (?from=JFK&to=LHR&dates=any&nights=7&window=180). */
export function flexFromParams(params: URLSearchParams, fallbackCurrency: string): FlexQuery | null {
  const trip = tripFromParams(params, fallbackCurrency);
  if (!trip || params.get('dates') !== 'any') return null;
  const nights = Number(params.get('nights'));
  const window = Number(params.get('window') ?? FLEX_DEFAULT_WINDOW_DAYS);
  return {
    ...trip,
    tripDays: params.has('nights') && Number.isInteger(nights) && nights >= 1 && nights <= FLEX_MAX_TRIP_DAYS ? nights : null,
    // An older link may ask for a longer period than can be searched: give it the longest there is.
    windowDays: Number.isInteger(window) && window >= 7 ? Math.min(window, FLEX_MAX_WINDOW_DAYS) : FLEX_DEFAULT_WINDOW_DAYS,
  };
}

export function flexPath(f: FlexQuery): string {
  const params = tripParams(f);
  params.set('dates', 'any');
  if (f.tripDays != null) params.set('nights', String(f.tripDays));
  params.set('window', String(f.windowDays));
  return `/?${addTripOptions(params, f).toString()}`;
}

/** The flexible search a flexible watch stands for. */
export function flexOfWatch(watch: Pick<Watch, 'query' | 'flex'>): FlexQuery | null {
  if (!watch.flex) return null;
  const { origin, destination, adults, cabin, currency, maxStops } = watch.query;
  return { origin, destination, adults, cabin, currency, maxStops, ...watch.flex };
}

export function sameQuery(a: SearchQuery, b: SearchQuery): boolean {
  return (
    a.origin === b.origin &&
    a.destination === b.destination &&
    a.departDate === b.departDate &&
    a.returnDate === b.returnDate &&
    a.adults === b.adults &&
    a.cabin === b.cabin &&
    a.currency === b.currency &&
    a.maxStops === b.maxStops
  );
}

export function sameFlex(a: FlexQuery, b: FlexQuery): boolean {
  return (
    a.origin === b.origin &&
    a.destination === b.destination &&
    a.tripDays === b.tripDays &&
    a.windowDays === b.windowDays &&
    a.adults === b.adults &&
    a.cabin === b.cabin &&
    a.currency === b.currency &&
    a.maxStops === b.maxStops
  );
}
