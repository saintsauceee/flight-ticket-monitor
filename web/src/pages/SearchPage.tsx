import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarRange, ExternalLink, History, PlaneTakeoff, RefreshCw, Scale, SearchX } from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import type { FlexQuery, FlightOffer, SearchQuery, SearchResult, WatchSummary } from '@shared/types';
import { AirlineCompare } from '@/components/AirlineCompare';
import { BagPrefsControl } from '@/components/Bags';
import { DateStrip } from '@/components/DateStrip';
import { OfferCard, priceOffer } from '@/components/OfferCard';
import { LevelBadge, LevelMeter } from '@/components/PriceLevel';
import { SearchForm } from '@/components/SearchForm';
import { Sparkline } from '@/components/Sparkline';
import { TrackBox } from '@/components/TrackBox';
import { Button, Card, cx, EmptyState, ErrorNote, Segmented, Select, Skeleton } from '@/components/ui';
import { api, keys } from '@/lib/api';
import { money, plural, relativeTime, travellers, tripDates } from '@/lib/format';
import { usePrefs } from '@/lib/prefs';
import { flexFromParams, flexPath, queryFromParams, sameQuery, searchPath } from '@/lib/query';
import { useTitle } from '@/lib/useTitle';

// Loaded on demand: the flexible-date results bring the charting library with them.
const FlexSearch = lazy(() => import('./FlexSearch').then((m) => ({ default: m.FlexSearch })));

type Sort = 'total' | 'duration' | 'depart';
type StopFilter = 'any' | '0' | '1';
const PAGE = 12;

function Insight({ result, watch }: { result: SearchResult; watch: WatchSummary | undefined }) {
  const { insights, query } = result;
  const lowest = insights?.lowestPrice ?? result.offers[0]?.price ?? null;
  const history = insights?.history ?? [];
  const pastPrices = history.map((p) => p.price);

  return (
    <Card className="grid gap-x-8 gap-y-5 p-4 sm:p-5 lg:grid-cols-[auto_minmax(0,1fr)_17rem] lg:items-center">
      <div>
        <div className="text-xs text-ink-3">Lowest fare{query.adults > 1 ? ` for ${query.adults}` : ''}</div>
        <div className="mt-0.5 flex items-baseline gap-2.5">
          <span className="text-[2.5rem] leading-none font-semibold tracking-tight">{lowest != null ? money(lowest, query.currency) : '—'}</span>
          {insights?.level && <LevelBadge level={insights.level} />}
        </div>
        <div className="mt-1.5 text-[13px] text-ink-3">
          {insights?.typicalRange
            ? `Usually ${money(insights.typicalRange[0], query.currency)}–${money(insights.typicalRange[1], query.currency)} for this trip`
            : 'No typical range available for this trip'}
        </div>
      </div>

      <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2 sm:items-center">
        {insights?.typicalRange && lowest != null && (
          <div>
            <div className="mb-2 text-xs text-ink-3">Against the typical range</div>
            <LevelMeter price={lowest} range={insights.typicalRange} currency={query.currency} />
          </div>
        )}
        {history.length > 1 && (
          <div>
            <div className="mb-1 text-xs text-ink-3">Last {plural(Math.round((Date.now() - new Date(history[0]!.t).getTime()) / 86_400_000), 'day')}</div>
            <div className="flex items-center gap-3">
              <Sparkline points={[...history, ...(lowest != null ? [{ t: result.fetchedAt, price: lowest }] : [])]} width={150} height={40} />
              <div className="tnum text-xs leading-relaxed text-ink-3">
                <div>High {money(Math.max(...pastPrices), query.currency)}</div>
                <div>Low {money(Math.min(...pastPrices), query.currency)}</div>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="border-line max-lg:border-t max-lg:pt-4 lg:border-l lg:pl-8">
        <TrackBox
          input={{ query }}
          watch={watch}
          currency={query.currency}
          title="Track this trip"
          blurb="Record the price on a schedule and get alerted when it drops."
          targetHint={lowest != null ? `Optional. For example ${Math.round(lowest * 0.9)} to be alerted on a 10% drop.` : undefined}
        />
      </div>
    </Card>
  );
}

function Results({ result, watch, onRefresh, refreshing }: { result: SearchResult; watch: WatchSummary | undefined; onRefresh: () => void; refreshing: boolean }) {
  const { query, offers, airports } = result;
  const prefs = usePrefs();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'flights' | 'airlines'>('flights');
  const [sort, setSort] = useState<Sort>('total');
  const [stops, setStops] = useState<StopFilter>('any');
  const [airline, setAirline] = useState<string>('all');
  const [limit, setLimit] = useState(PAGE);

  const details = useMutation({
    mutationFn: (offerId: string) => api.offerDetails(query, offerId),
    onSuccess: (detailed) => {
      queryClient.setQueryData<SearchResult>(keys.search(query), (current) =>
        current ? { ...current, offers: current.offers.map((o) => (o.id === detailed.id ? detailed : o)) } : current,
      );
      void queryClient.invalidateQueries({ queryKey: keys.meta });
    },
  });

  const airlines = useMemo(() => {
    const seen = new Map<string, string>();
    for (const o of offers) seen.set(o.airline.code, o.airline.name);
    return [...seen].sort((a, b) => a[1].localeCompare(b[1]));
  }, [offers]);

  const priced = useMemo(() => offers.map((offer) => ({ offer, pricing: priceOffer(offer, prefs.bags, query.adults) })), [offers, prefs.bags, query.adults]);

  const shown = useMemo(() => {
    const maxStops = stops === 'any' ? Infinity : Number(stops);
    const list = priced.filter(({ offer }) => offer.slices.every((s) => s.stops <= maxStops) && (airline === 'all' || offer.airline.code === airline));
    const departAt = (o: FlightOffer) => o.slices[0]?.segments[0]?.departAt ?? '';
    return list.sort((a, b) =>
      sort === 'total'
        ? a.pricing.total - b.pricing.total || a.offer.durationMin - b.offer.durationMin
        : sort === 'duration'
          ? a.offer.durationMin - b.offer.durationMin || a.pricing.total - b.pricing.total
          : departAt(a.offer).localeCompare(departAt(b.offer)),
    );
  }, [priced, stops, airline, sort]);

  const cheapestId = shown.reduce<(typeof shown)[number] | null>((min, x) => (!min || x.pricing.total < min.pricing.total ? x : min), null)?.offer.id;
  const fastestId = shown.reduce<(typeof shown)[number] | null>((min, x) => (!min || x.offer.durationMin < min.offer.durationMin ? x : min), null)?.offer.id;
  const origin = airports[query.origin];
  const destination = airports[query.destination];

  return (
    <div className={cx('space-y-5 transition-opacity', refreshing && 'opacity-60')}>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            {origin?.city ?? query.origin} <span className="text-ink-3">to</span> {destination?.city ?? query.destination}
          </h1>
          <p className="mt-0.5 text-[13px] text-ink-3">
            {tripDates(query)} · {travellers(query)} · {plural(offers.length, 'flight')} from {plural(airlines.length, 'airline')}
          </p>
        </div>
        <div className="flex items-center gap-1 text-[13px] whitespace-nowrap text-ink-3 max-sm:w-full max-sm:justify-between">
          <span title={new Date(result.fetchedAt).toLocaleString()}>Prices from {relativeTime(result.fetchedAt)}</span>
          <span className="flex items-center gap-1 max-sm:-mr-2.5">
            <Button
              variant="ghost"
              size="sm"
              onClick={onRefresh}
              loading={refreshing}
              title={result.provider.costPerSearch > 0 ? `Fetch fresh prices (uses ${plural(result.provider.costPerSearch, 'search', 'searches')})` : 'Fetch fresh prices'}
            >
              {!refreshing && <RefreshCw className="size-3.5" aria-hidden />}
              {/* Phones: the icon alone, so the row fits on one line. */}
              <span className="max-sm:sr-only">Refresh</span>
            </Button>
            {result.externalUrl && (
              <a
                href={result.externalUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 font-medium text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
              >
                Google Flights
                <ExternalLink className="size-3.5" aria-hidden />
              </a>
            )}
          </span>
        </div>
      </div>

      {offers.length === 0 ? (
        <EmptyState icon={<SearchX className="size-5" />} title="No flights found for these dates">
          Try other dates, allow more stops, or check nearby airports.
        </EmptyState>
      ) : (
        <>
          <Insight result={result} watch={watch} />
          <DateStrip query={query} provider={result.provider} />

          <section aria-label="Flights">
            <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-3">
              <Segmented
                label="Results view"
                value={tab}
                onChange={setTab}
                options={[
                  { value: 'flights', label: `Flights (${shown.length})` },
                  { value: 'airlines', label: `Compare airlines (${airlines.length})` },
                ]}
              />
              <div className="max-sm:w-full sm:ml-auto">
                <BagPrefsControl prefs={prefs.bags} />
              </div>
            </div>

            {tab === 'airlines' ? (
              <AirlineCompare offers={offers} bags={prefs.bags} adults={query.adults} currency={query.currency} />
            ) : (
              <>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <Segmented
                    label="Sort"
                    size="sm"
                    value={sort}
                    onChange={setSort}
                    options={[
                      { value: 'total', label: 'Cheapest' },
                      { value: 'duration', label: 'Fastest' },
                      { value: 'depart', label: 'Earliest' },
                    ]}
                  />
                  <Segmented
                    label="Stops"
                    size="sm"
                    value={stops}
                    onChange={(v) => {
                      setStops(v);
                      setLimit(PAGE);
                    }}
                    options={[
                      { value: 'any', label: 'Any stops' },
                      { value: '0', label: 'Nonstop' },
                      { value: '1', label: '1 stop max' },
                    ]}
                  />
                  <Select
                    label="Airline"
                    size="sm"
                    value={airline}
                    onChange={(value) => {
                      setAirline(value);
                      setLimit(PAGE);
                    }}
                  >
                    <option value="all">All airlines</option>
                    {airlines.map(([code, name]) => (
                      <option key={code} value={code}>
                        {name}
                      </option>
                    ))}
                  </Select>
                </div>

                {shown.length === 0 ? (
                  <EmptyState icon={<SearchX className="size-5" />} title="No flights match these filters">
                    Loosen the stop or airline filter to see more options.
                  </EmptyState>
                ) : (
                  <div className="space-y-2.5">
                    {shown.slice(0, limit).map(({ offer, pricing }) => (
                      <OfferCard
                        key={offer.id}
                        offer={offer}
                        pricing={pricing}
                        adults={query.adults}
                        airports={airports}
                        roundTrip={query.returnDate != null}
                        tags={[offer.id === cheapestId && 'Cheapest', offer.id === fastestId && 'Fastest'].filter((t): t is string => !!t)}
                        onLoadDetails={() => details.mutate(offer.id)}
                        loadingDetails={details.isPending && details.variables === offer.id}
                        detailsError={details.isError && details.variables === offer.id ? details.error.message : null}
                      />
                    ))}
                    {shown.length > limit && (
                      <div className="pt-1 text-center">
                        <Button onClick={() => setLimit(shown.length)}>Show all {shown.length} flights</Button>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Feature({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-card">
      <div className="mb-2.5 flex size-8 items-center justify-center rounded-lg bg-accent-soft text-accent-strong">{icon}</div>
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-1 text-[13px] text-ink-3">{children}</p>
    </div>
  );
}

function Welcome({ currency }: { currency: string }) {
  const samples: [string, string, string, number][] = [
    ['JFK', 'LHR', 'New York → London', 7],
    ['SFO', 'NRT', 'San Francisco → Tokyo', 10],
    ['SIN', 'BKK', 'Singapore → Bangkok', 4],
    ['LHR', 'BCN', 'London → Barcelona', 4],
  ];
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <Feature icon={<CalendarRange className="size-4" />} title="Cheapest dates">
          Search any dates to see the lowest fare for every day of the coming months, then open a date to compare its flights.
        </Feature>
        <Feature icon={<History className="size-4" />} title="Price history and alerts">
          Track a trip, with or without fixed dates. Every check is recorded, and you are told when a cheap fare shows up.
        </Feature>
        <Feature icon={<Scale className="size-4" />} title="Airlines side by side">
          Compare carriers on total price with your bags, legroom, Wi-Fi, fare rules and emissions.
        </Feature>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <span className="text-ink-3">Try a route, any dates:</span>
        {samples.map(([from, to, label, nights]) => (
          <Link
            key={label}
            to={flexPath({ origin: from, destination: to, tripDays: nights, windowDays: 180, adults: 1, cabin: 'economy', currency, maxStops: null })}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 font-medium text-ink-2 shadow-card transition-colors hover:border-line-strong hover:text-ink"
          >
            <PlaneTakeoff className="size-3.5 text-ink-3" aria-hidden />
            {label}
          </Link>
        ))}
      </div>
    </div>
  );
}

function ResultsSkeleton() {
  return (
    <div className="space-y-5" aria-busy aria-label="Searching for flights">
      <Skeleton className="h-12 w-72" />
      <Skeleton className="h-28" />
      <Skeleton className="h-36" />
      <div className="space-y-2.5">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-[5.5rem]" />
        ))}
      </div>
    </div>
  );
}

export function SearchPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const prefs = usePrefs();
  const queryClient = useQueryClient();
  const paramString = params.toString();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the string captures everything the params object holds
  const flex = useMemo<FlexQuery | null>(() => flexFromParams(params, prefs.currency), [paramString, prefs.currency]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- as above
  const query = useMemo<SearchQuery | null>(() => (flex ? null : queryFromParams(params, prefs.currency)), [paramString, prefs.currency]);

  const search = useQuery({
    queryKey: query ? keys.search(query) : ['search', 'idle'],
    queryFn: () => api.search(query as SearchQuery),
    enabled: !!query,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const refresh = useMutation({
    mutationFn: () => api.search(query as SearchQuery, true),
    onSuccess: (fresh) => {
      queryClient.setQueryData(keys.search(fresh.query), fresh);
      void queryClient.invalidateQueries({ queryKey: keys.meta });
    },
  });
  const { data: watches } = useQuery({ queryKey: keys.watches, queryFn: api.watches });
  const watch = query ? watches?.find((w) => w.kind === 'fixed' && sameQuery(w.query, query)) : undefined;

  useTitle(query ? `${query.origin} → ${query.destination}` : flex ? `${flex.origin} → ${flex.destination} · any dates` : null);
  // Effect bodies are wrapped in braces on purpose: React calls whatever an
  // effect returns as its cleanup, and browser methods may return a value
  // (window.scrollTo returns a Promise in current Chrome).
  useEffect(() => {
    refresh.reset();
  }, [paramString]); // eslint-disable-line react-hooks/exhaustive-deps -- reset only when the search changes
  // Opening a date from the any-dates results (or going back) shows a different page: start it at the top.
  const flexible = flex != null;
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [flexible]);

  return (
    <div className="space-y-6">
      {!query && !flex && (
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-[1.75rem]">Find the cheapest dates to fly, then keep watching them.</h1>
          <p className="mt-1.5 max-w-2xl text-ink-3">See the lowest fare for every day of the coming months, compare airlines on what you will really pay, and get told when a cheap fare appears.</p>
        </div>
      )}

      <SearchForm
        initial={query}
        initialFlex={flex}
        busy={search.isFetching && !search.data}
        onSearch={(q) => navigate(searchPath(q))}
        onSearchFlex={(f) => navigate(flexPath(f))}
      />

      {flex ? (
        <Suspense fallback={<Skeleton className="h-96" />}>
          <FlexSearch flex={flex} />
        </Suspense>
      ) : !query ? (
        <Welcome currency={prefs.currency} />
      ) : search.isPending ? (
        <ResultsSkeleton />
      ) : search.isError ? (
        <ErrorNote
          title="The search did not go through"
          message={search.error.message}
          action={
            <Button size="sm" onClick={() => void search.refetch()}>
              Try again
            </Button>
          }
        />
      ) : (
        <>
          {refresh.isError && <ErrorNote title="Could not refresh prices" message={refresh.error.message} />}
          <Results key={paramString} result={search.data} watch={watch} onRefresh={() => refresh.mutate()} refreshing={refresh.isPending} />
        </>
      )}
    </div>
  );
}
