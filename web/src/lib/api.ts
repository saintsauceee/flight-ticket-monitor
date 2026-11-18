import type {
  Airport,
  Alert,
  CalendarResult,
  CreateWatchInput,
  FlexQuery,
  FlexResult,
  FlightOffer,
  Meta,
  SearchQuery,
  SearchResult,
  UpdateWatchInput,
  WatchDetail,
  WatchSummary,
} from '@shared/types';

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiRequestError('Cannot reach the server. Is it running?', 0, 'network');
  }
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    let code: string | null = null;
    try {
      const body = (await res.json()) as { error?: string; code?: string };
      if (body.error) message = body.error;
      code = body.code ?? null;
    } catch {
      // Not JSON (e.g. a proxy error page): keep the generic message.
      if (res.status >= 500) message = 'The server is not responding. Is it running?';
    }
    throw new ApiRequestError(message, res.status, code);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

export function queryString(q: SearchQuery, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams({
    origin: q.origin,
    destination: q.destination,
    departDate: q.departDate,
    adults: String(q.adults),
    cabin: q.cabin,
    currency: q.currency,
    ...extra,
  });
  if (q.returnDate) params.set('returnDate', q.returnDate);
  if (q.maxStops != null) params.set('maxStops', String(q.maxStops));
  return params.toString();
}

export function flexQueryString(f: FlexQuery, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams({
    origin: f.origin,
    destination: f.destination,
    windowDays: String(f.windowDays),
    adults: String(f.adults),
    cabin: f.cabin,
    currency: f.currency,
    ...extra,
  });
  if (f.tripDays != null) params.set('tripDays', String(f.tripDays));
  if (f.maxStops != null) params.set('maxStops', String(f.maxStops));
  return params.toString();
}

export const api = {
  meta: () => request<Meta>('/api/meta'),
  airports: (q: string, limit = 8) => request<Airport[]>(`/api/airports?q=${encodeURIComponent(q)}&limit=${limit}`),
  search: (q: SearchQuery, refresh = false) => request<SearchResult>(`/api/search?${queryString(q, refresh ? { refresh: '1' } : {})}`),
  flex: (f: FlexQuery, refresh = false) => request<FlexResult>(`/api/flex?${flexQueryString(f, refresh ? { refresh: '1' } : {})}`),
  calendar: (q: SearchQuery, window: number, cachedOnly: boolean) =>
    request<CalendarResult>(`/api/calendar?${queryString(q, { window: String(window), ...(cachedOnly ? { cachedOnly: '1' } : {}) })}`),
  offerDetails: (query: SearchQuery, offerId: string) => request<FlightOffer>('/api/offers/details', json('POST', { query, offerId })),
  watches: () => request<WatchSummary[]>('/api/watches'),
  watch: (id: number) => request<WatchDetail>(`/api/watches/${id}`),
  createWatch: (input: CreateWatchInput) => request<WatchSummary>('/api/watches', json('POST', input)),
  updateWatch: (id: number, patch: UpdateWatchInput) => request<WatchSummary>(`/api/watches/${id}`, json('PATCH', patch)),
  deleteWatch: (id: number) => request<void>(`/api/watches/${id}`, { method: 'DELETE' }),
  checkWatch: (id: number) => request<WatchDetail>(`/api/watches/${id}/check`, { method: 'POST' }),
  alerts: () => request<{ alerts: Alert[]; unread: number }>('/api/alerts'),
  markAlertsRead: (target: { ids?: number[]; watchId?: number } = {}) =>
    request<{ updated: number; unread: number }>('/api/alerts/read', json('POST', target)),
};

export const keys = {
  meta: ['meta'] as const,
  search: (q: SearchQuery) => ['search', q] as const,
  flex: (f: FlexQuery) => ['flex', f] as const,
  calendar: (q: SearchQuery, window: number) => ['calendar', q, window] as const,
  watches: ['watches'] as const,
  watch: (id: number) => ['watch', id] as const,
  alerts: ['alerts'] as const,
};
