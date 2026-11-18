import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, Search } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import {
  CABIN_LABELS,
  CABINS,
  CURRENCIES,
  FLEX_MAX_WINDOW_DAYS,
  FLEX_WINDOWS,
  flexScanCost,
  type Airport,
  type CabinClass,
  type FlexQuery,
  type SearchQuery,
} from '@shared/types';
import { api } from '@/lib/api';
import { addDays, plural, todayString } from '@/lib/format';
import { setPrefs, usePrefs } from '@/lib/prefs';
import { AirportInput } from './AirportInput';
import { useMeta } from './Layout';
import { Button, Card, cx, FieldLabel, inputClass, Segmented, Select } from './ui';

/** Resolves an airport code to its full record (for showing the city of a code that came from the URL). */
function useAirport(code: string | null): Airport | null {
  const { data } = useQuery({
    queryKey: ['airport', code],
    queryFn: async () => (await api.airports(code as string, 3)).find((a) => a.code === code) ?? null,
    enabled: !!code,
    staleTime: Infinity,
  });
  if (!code) return null;
  return data ?? { code, name: '', city: code, country: '', lat: 0, lon: 0 };
}

const TRIP_LENGTHS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 21, 28];

export function SearchForm({
  initial,
  initialFlex,
  onSearch,
  onSearchFlex,
  busy,
}: {
  /** The search in the URL, when it has exact dates. */
  initial: SearchQuery | null;
  /** The search in the URL, when its dates are flexible. */
  initialFlex: FlexQuery | null;
  onSearch: (query: SearchQuery) => void;
  onSearchFlex: (query: FlexQuery) => void;
  busy: boolean;
}) {
  const prefs = usePrefs();
  const queryClient = useQueryClient();
  const { data: meta } = useMeta();
  const today = todayString();
  const shown = initial ?? initialFlex;

  const [anyDates, setAnyDates] = useState(initialFlex ? true : initial ? false : prefs.dateMode === 'any');
  const [roundTrip, setRoundTrip] = useState(initialFlex ? initialFlex.tripDays != null : initial ? initial.returnDate != null : true);
  const [originCode, setOriginCode] = useState<string | null>(shown?.origin ?? prefs.lastOrigin);
  const [destinationCode, setDestinationCode] = useState<string | null>(shown?.destination ?? prefs.lastDestination);
  const [departDate, setDepartDate] = useState(initial?.departDate ?? todayString(45));
  const [returnDate, setReturnDate] = useState(initial?.returnDate ?? addDays(initial?.departDate ?? todayString(45), 7));
  const [tripDays, setTripDays] = useState(initialFlex?.tripDays ?? prefs.tripDays);
  // A remembered period can be longer than is offered now; never ask for more than exists.
  const [windowDays, setWindowDays] = useState(Math.min(initialFlex?.windowDays ?? prefs.windowDays, FLEX_MAX_WINDOW_DAYS));
  const [adults, setAdults] = useState(shown?.adults ?? 1);
  const [cabin, setCabin] = useState<CabinClass>(shown?.cabin ?? 'economy');
  const [maxStops, setMaxStops] = useState<number | null>(shown?.maxStops ?? null);
  const [currency, setCurrency] = useState(shown?.currency ?? prefs.currency);
  const [error, setError] = useState<string | null>(null);

  // Follow the URL when it changes underneath the form (back/forward, date strip, links).
  useEffect(() => {
    const next = initial ?? initialFlex;
    if (!next) return;
    setOriginCode(next.origin);
    setDestinationCode(next.destination);
    setAdults(next.adults);
    setCabin(next.cabin);
    setMaxStops(next.maxStops);
    setCurrency(next.currency);
    setError(null);
    if (initial) {
      setAnyDates(false);
      setRoundTrip(initial.returnDate != null);
      setDepartDate(initial.departDate);
      if (initial.returnDate) setReturnDate(initial.returnDate);
    } else if (initialFlex) {
      setAnyDates(true);
      setRoundTrip(initialFlex.tripDays != null);
      if (initialFlex.tripDays != null) setTripDays(initialFlex.tripDays);
      setWindowDays(initialFlex.windowDays);
    }
  }, [initial, initialFlex]);

  const origin = useAirport(originCode);
  const destination = useAirport(destinationCode);

  const pick = (set: (code: string | null) => void) => (airport: Airport | null) => {
    if (airport) queryClient.setQueryData(['airport', airport.code], airport);
    set(airport?.code ?? null);
    setError(null);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!originCode || !destinationCode) return setError('Choose where you are flying from and to.');
    if (originCode === destinationCode) return setError('Origin and destination are the same airport.');
    const trip = { origin: originCode, destination: destinationCode, adults, cabin, currency, maxStops };

    if (anyDates) {
      setError(null);
      setPrefs({ lastOrigin: originCode, lastDestination: destinationCode, currency, dateMode: 'any', tripDays, windowDays });
      return onSearchFlex({ ...trip, tripDays: roundTrip ? tripDays : null, windowDays });
    }

    if (!departDate) return setError('Choose a departure date.');
    if (departDate < today) return setError('The departure date is in the past.');
    if (roundTrip && (!returnDate || returnDate < departDate)) return setError('The return date must be on or after the departure date.');
    setError(null);
    setPrefs({ lastOrigin: originCode, lastDestination: destinationCode, currency, dateMode: 'exact' });
    onSearch({ ...trip, departDate, returnDate: roundTrip ? returnDate : null });
  };

  const scanCost = meta ? flexScanCost(meta.provider) : 0;

  return (
    <Card className="p-4 sm:p-5">
      <form onSubmit={submit} noValidate>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Segmented
            label="Trip type"
            value={roundTrip ? 'round' : 'oneway'}
            onChange={(v) => setRoundTrip(v === 'round')}
            options={[
              { value: 'round', label: 'Round trip' },
              { value: 'oneway', label: 'One way' },
            ]}
          />
          <Segmented
            label="Dates"
            value={anyDates ? 'any' : 'exact'}
            onChange={(v) => {
              setAnyDates(v === 'any');
              setError(null);
            }}
            options={[
              { value: 'any', label: 'Any dates', title: 'Find the cheapest dates to fly in the coming months' },
              { value: 'exact', label: 'Exact dates', title: 'Compare the flights on dates you choose' },
            ]}
          />
          {/* Phones: a tidy two-by-two grid under the toggles. Wider: inline with them. */}
          <div className="grid grid-cols-2 gap-2 max-sm:w-full sm:contents">
            <Select label="Travellers" value={String(adults)} onChange={(v) => setAdults(Number(v))}>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                <option key={n} value={n}>
                  {n} {n === 1 ? 'adult' : 'adults'}
                </option>
              ))}
            </Select>
            <Select label="Cabin" value={cabin} onChange={(v) => setCabin(v as CabinClass)}>
              {CABINS.map((c) => (
                <option key={c} value={c}>
                  {CABIN_LABELS[c]}
                </option>
              ))}
            </Select>
            <Select label="Stops" value={maxStops == null ? 'any' : String(maxStops)} onChange={(v) => setMaxStops(v === 'any' ? null : Number(v))}>
              <option value="any">Any stops</option>
              <option value="0">Nonstop only</option>
              <option value="1">1 stop or fewer</option>
              <option value="2">2 stops or fewer</option>
            </Select>
            <Select label="Currency" value={currency} onChange={setCurrency}>
              {(CURRENCIES as readonly string[]).includes(currency) ? null : <option value={currency}>{currency}</option>}
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_9.5rem_9.5rem_auto] lg:items-end">
          <AirportInput label="From" value={origin} onChange={pick(setOriginCode)} placeholder="Origin city or airport" />
          <button
            type="button"
            aria-label="Swap origin and destination"
            title="Swap"
            onClick={() => {
              setOriginCode(destinationCode);
              setDestinationCode(originCode);
            }}
            className="mx-auto flex size-10 items-center justify-center rounded-full border border-line-strong/70 bg-surface text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink max-lg:-my-1 max-lg:size-8 max-lg:rotate-90"
          >
            <ArrowLeftRight className="size-4" aria-hidden />
          </button>
          <AirportInput label="To" value={destination} onChange={pick(setDestinationCode)} placeholder="Destination city or airport" />
          {anyDates ? (
            <div className="grid grid-cols-2 gap-3 lg:contents">
              <div>
                <FieldLabel htmlFor="look-ahead">Leaving within</FieldLabel>
                <Select id="look-ahead" variant="outline" size="lg" className="w-full" value={String(windowDays)} onChange={(v) => setWindowDays(Number(v))}>
                  {FLEX_WINDOWS.some((w) => w.days === windowDays) ? null : <option value={windowDays}>{windowDays} days</option>}
                  {FLEX_WINDOWS.map((w) => (
                    <option key={w.days} value={w.days}>
                      {w.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className={cx(!roundTrip && 'opacity-45')}>
                <FieldLabel htmlFor="trip-length">Trip length</FieldLabel>
                <Select
                  id="trip-length"
                  variant="outline"
                  size="lg"
                  className="w-full"
                  disabled={!roundTrip}
                  value={roundTrip ? String(tripDays) : ''}
                  onChange={(v) => setTripDays(Number(v))}
                >
                  {!roundTrip && <option value="">One way</option>}
                  {[...new Set([...TRIP_LENGTHS, tripDays])]
                    .sort((a, b) => a - b)
                    .map((n) => (
                      <option key={n} value={n}>
                        {plural(n, 'night')}
                      </option>
                    ))}
                </Select>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 lg:contents">
              <div>
                <FieldLabel htmlFor="depart-date">Depart</FieldLabel>
                <input
                  id="depart-date"
                  type="date"
                  required
                  min={today}
                  value={departDate}
                  onChange={(e) => {
                    const next = e.target.value;
                    // Keep the trip length when the departure moves past the return.
                    if (next && returnDate && returnDate < next) setReturnDate(addDays(next, 7));
                    setDepartDate(next);
                  }}
                  className={cx(inputClass, 'tnum')}
                />
              </div>
              <div className={cx(!roundTrip && 'opacity-45')}>
                <FieldLabel htmlFor="return-date">Return</FieldLabel>
                <input
                  id="return-date"
                  type="date"
                  disabled={!roundTrip}
                  min={departDate || today}
                  value={roundTrip ? returnDate : ''}
                  onChange={(e) => setReturnDate(e.target.value)}
                  className={cx(inputClass, 'tnum disabled:cursor-not-allowed')}
                />
              </div>
            </div>
          )}
          <Button type="submit" variant="primary" size="lg" loading={busy} className="h-10 max-lg:w-full">
            {!busy && <Search className="size-4" aria-hidden />}
            Search
          </Button>
        </div>

        {error ? (
          <p role="alert" className="mt-3 text-[13px] font-medium text-bad-ink">
            {error}
          </p>
        ) : (
          anyDates && (
            <p className="mt-3 text-[13px] text-ink-3">
              Finds the lowest fare for every departure date in that period{roundTrip ? `, returning ${plural(tripDays, 'night')} later` : ''}.
              {scanCost > 0 && ` Uses ${plural(scanCost, 'search', 'searches')}.`}
            </p>
          )
        )}
      </form>
    </Card>
  );
}
