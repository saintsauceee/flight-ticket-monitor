import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Plane, PlaneTakeoff, RefreshCw, SearchX } from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import type { FlexQuery, FlightOffer, SearchQuery, SearchResult, WatchSummary } from '@shared/types';
import { AirlineCompare } from '@/components/AirlineCompare';
import { BagPrefsControl } from '@/components/Bags';
import { DateStrip } from '@/components/DateStrip';
import { LandingStory } from '@/components/LandingStory';
import { Band, PageBody } from '@/components/Layout';
import { OfferCard, priceOffer } from '@/components/OfferCard';
import { LevelBadge, LevelMeter } from '@/components/PriceLevel';
import { SearchForm } from '@/components/SearchForm';
import { Sparkline } from '@/components/Sparkline';
import { TrackBox } from '@/components/TrackBox';
import { Button, buttonClass, Card, cx, EmptyState, ErrorNote, RouteTitle, Segmented, Select, Skeleton } from '@/components/ui';
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
    <Card className="overflow-hidden lg:grid lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="grid gap-x-10 gap-y-6 p-5 sm:p-6 md:grid-cols-[auto_minmax(0,1fr)] md:items-center">
        <div>
          <div className="eyebrow">Lowest fare{query.adults > 1 ? ` for ${query.adults}` : ''}</div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="display text-5xl leading-none font-extrabold">{lowest != null ? money(lowest, query.currency) : '—'}</span>
            {insights?.level && <LevelBadge level={insights.level} />}
          </div>
          <div className="mt-2.5 text-[13px] text-ink-3">
            {insights?.typicalRange
              ? `Usually ${money(insights.typicalRange[0], query.currency)}–${money(insights.typicalRange[1], query.currency)} for this trip`
              : 'No typical range available for this trip'}
          </div>
        </div>

        <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2 sm:items-center md:border-l md:border-line md:pl-10">
          {insights?.typicalRange && lowest != null && (
            <div>
              <div className="mb-2.5 text-xs font-medium text-ink-3">Against the typical range</div>
              <LevelMeter price={lowest} range={insights.typicalRange} currency={query.currency} />
            </div>
          )}
          {history.length > 1 && (
            <div>
              <div className="mb-1 text-xs font-medium text-ink-3">Last {plural(Math.round((Date.now() - new Date(history[0]!.t).getTime()) / 86_400_000), 'day')}</div>
              <Sparkline points={[...history, ...(lowest != null ? [{ t: result.fetchedAt, price: lowest }] : [])]} width={150} height={40} />
              <div className="tnum mt-0.5 text-xs whitespace-nowrap text-ink-3">
                Low {money(Math.min(...pastPrices), query.currency)} · High {money(Math.max(...pastPrices), query.currency)}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="border-line bg-surface-2/70 p-5 max-lg:border-t sm:p-6 lg:border-l">
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
    <div className={cx('space-y-6 transition-opacity', refreshing && 'opacity-60')}>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <h1 className="display text-2xl font-extrabold sm:text-[1.75rem]">
            <RouteTitle from={origin?.city ?? query.origin} to={destination?.city ?? query.destination} />
          </h1>
          <p className="mt-1 text-[13px] text-ink-3">
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
                className={buttonClass('ghost', 'sm')}
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
            <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-3">
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
                  <div className="space-y-3">
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

const SAMPLES: [string, string, string, number][] = [
  ['JFK', 'LHR', 'New York → London', 7],
  ['SFO', 'NRT', 'San Francisco → Tokyo', 10],
  ['SIN', 'BKK', 'Singapore → Bangkok', 4],
  ['LHR', 'BCN', 'London → Barcelona', 4],
];

/** Example searches, shown on the band under the empty search form. */
function SampleRoutes({ currency }: { currency: string }) {
  return (
    <div className="mt-5 flex flex-wrap items-center gap-2 text-[13px]">
      <span className="mr-1 text-white/55">Try a route, any dates:</span>
      {SAMPLES.map(([from, to, label, nights]) => (
        <Link
          key={label}
          to={flexPath({ origin: from, destination: to, tripDays: nights, windowDays: 180, adults: 1, cabin: 'economy', currency, maxStops: null })}
          className="tap-target inline-flex h-8 items-center gap-1.5 rounded-full bg-white/[0.08] pr-3.5 pl-3 font-semibold text-white/85 ring-1 ring-white/10 transition-colors ring-inset hover:bg-white/[0.15] hover:text-white hover:ring-white/20"
        >
          <PlaneTakeoff className="size-3.5 opacity-60" aria-hidden />
          {label}
        </Link>
      ))}
    </div>
  );
}

/** A flight path drawn faintly across the right of the landing band. Decoration only. */
function HeroArt() {
  return (
    <div className="hero-art-drift absolute top-8 right-[max(1.5rem,calc(50%-35rem))] hidden h-56 w-[30rem] text-white lg:block">
      <svg viewBox="0 0 480 224" fill="none" className="size-full">
        <path d="M14 206 C 150 196, 310 132, 444 40" stroke="currentColor" strokeOpacity="0.3" strokeWidth="1.5" strokeDasharray="1 8" strokeLinecap="round" />
        <circle cx="14" cy="206" r="3.5" fill="currentColor" fillOpacity="0.55" />
        <circle cx="14" cy="206" r="9" stroke="currentColor" strokeOpacity="0.18" />
      </svg>
      <Plane className="absolute top-[18px] left-[438px] size-6 rotate-[11deg] text-white/70" aria-hidden />
    </div>
  );
}

function ResultsSkeleton() {
  return (
    <div className="space-y-6" aria-busy aria-label="Searching for flights">
      <Skeleton className="h-12 w-72" />
      <Skeleton className="h-36" />
      <Skeleton className="h-40" />
      <div className="space-y-3">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-28" />
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

  const landing = !query && !flex;

  return (
    <>
      <Band className={landing ? 'pt-10 pb-10 sm:pt-16 sm:pb-14' : 'py-4 sm:py-5'} art={landing ? <HeroArt /> : undefined}>
        {landing && (
          <div className="mb-8 max-w-2xl sm:mb-10">
            <h1 className="display text-[2.25rem] leading-[1.05] font-extrabold sm:text-5xl sm:leading-[1.05]">
              {/* Two sentences, two lines: the break is set here rather than left to the browser's line balancing. */}
              Find the cheapest dates to fly. <span className="block text-sky-300">Then keep watching them.</span>
            </h1>
            <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-white/70 sm:text-base">
              See the lowest fare for every day of the coming months, compare airlines on what you will really pay, and get told when a cheap fare appears.
            </p>
          </div>
        )}

        <SearchForm
          initial={query}
          initialFlex={flex}
          busy={search.isFetching && !search.data}
          onSearch={(q) => navigate(searchPath(q))}
          onSearchFlex={(f) => navigate(flexPath(f))}
        />

        {landing && <SampleRoutes currency={prefs.currency} />}
      </Band>

      <PageBody>
        {flex ? (
          <Suspense fallback={<Skeleton className="h-96" />}>
            <FlexSearch flex={flex} />
          </Suspense>
        ) : !query ? (
          <LandingStory />
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
      </PageBody>
    </>
  );
}
