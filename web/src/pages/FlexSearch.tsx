import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowRight, RefreshCw, SearchX } from 'lucide-react';
import { useEffect } from 'react';
import { Link } from 'react-router';
import { flexScanCost, type FlexQuery, type FlexResult, type WatchSummary } from '@shared/types';
import { CheapestDates, dayPath, FareByDate, MonthGrid } from '@/components/FlexCalendar';
import { TrackBox } from '@/components/TrackBox';
import { Badge, Button, buttonClass, Card, cx, EmptyState, ErrorNote, RouteTitle, SectionTitle, Skeleton } from '@/components/ui';
import { api, keys } from '@/lib/api';
import { flexDates, money, plural, relativeTime, shortDay, travellers, tripLengthLabel, windowLabel } from '@/lib/format';
import { flexOfWatch, sameFlex } from '@/lib/query';

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[mid] as number) : Math.round(((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2);
}

function Results({ result, watch, onRefresh, refreshing }: { result: FlexResult; watch: WatchSummary | undefined; onRefresh: () => void; refreshing: boolean }) {
  const { query, days, cheapest, months, airports, provider } = result;
  const origin = airports[query.origin];
  const destination = airports[query.destination];
  const scanCost = flexScanCost(provider);
  const prices = days.map((d) => d.price);
  const typical = prices.length ? median(prices) : null;
  const dearest = days.reduce<(typeof days)[number] | null>((max, d) => (!max || d.price > max.price ? d : max), null);
  const nearLow = cheapest ? days.filter((d) => d.price <= cheapest.price * 1.05).length : 0;
  const belowTypical = cheapest && typical != null && typical > cheapest.price ? Math.round((1 - cheapest.price / typical) * 100) : 0;

  return (
    <div className={cx('space-y-6 transition-opacity', refreshing && 'opacity-60')}>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <h1 className="display text-2xl font-extrabold sm:text-[1.75rem]">
            <RouteTitle from={origin?.city ?? query.origin} to={destination?.city ?? query.destination} />
          </h1>
          <p className="mt-1 text-[13px] text-ink-3">
            Any dates, {shortDay(result.range.start)} – {shortDay(result.range.end)} · {tripLengthLabel(query.tripDays)} · {travellers(query)} · {plural(days.length, 'departure date')}
          </p>
        </div>
        <div className="flex items-center gap-1 text-[13px] whitespace-nowrap text-ink-3 max-sm:w-full max-sm:justify-between">
          <span title={new Date(result.fetchedAt).toLocaleString()}>Prices from {relativeTime(result.fetchedAt)}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={onRefresh}
            loading={refreshing}
            className="max-sm:-mr-2.5"
            title={scanCost > 0 ? `Fetch fresh prices (uses ${plural(scanCost, 'search', 'searches')})` : 'Fetch fresh prices'}
          >
            {!refreshing && <RefreshCw className="size-3.5" aria-hidden />}
            Refresh
          </Button>
        </div>
      </div>

      {!cheapest ? (
        <EmptyState icon={<SearchX className="size-5" />} title="No fares found for these dates">
          Try a longer period, allow more stops, or check nearby airports.
        </EmptyState>
      ) : (
        <>
          <Card className="overflow-hidden lg:grid lg:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="grid gap-x-10 gap-y-6 p-5 sm:p-6 md:grid-cols-[auto_minmax(0,1fr)] md:items-center">
              <div>
                <div className="eyebrow">Cheapest date{query.adults > 1 ? `, for ${query.adults}` : ''}</div>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <span className="display text-5xl leading-none font-extrabold">{money(cheapest.price, query.currency)}</span>
                  {belowTypical > 0 && (
                    <Badge tone="good">
                      <ArrowDown className="size-3" aria-hidden />
                      {belowTypical}% below typical
                    </Badge>
                  )}
                </div>
                <div className="mt-2.5 text-sm font-semibold text-ink-2">{flexDates(cheapest)}</div>
                <Link
                  to={dayPath(query, cheapest)}
                  title={provider.costPerSearch > 0 ? `Uses ${plural(provider.costPerSearch, 'search', 'searches')}` : undefined}
                  className={buttonClass('secondary', 'md', 'mt-4 sm:pr-3.5')}
                >
                  See flights and airlines
                  <ArrowRight className="size-4" aria-hidden />
                </Link>
              </div>

              <dl className="grid grid-cols-3 gap-x-6 gap-y-3 md:border-l md:border-line md:pl-10">
                <div>
                  <dt className="text-xs font-medium text-ink-3">Typical fare</dt>
                  <dd className="display mt-1 text-xl leading-tight font-bold">{typical != null ? money(typical, query.currency) : '—'}</dd>
                  <dd className="mt-0.5 text-xs text-ink-3">the middle fare of all dates</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-ink-3">Dearest date</dt>
                  <dd className="display mt-1 text-xl leading-tight font-bold">{dearest ? money(dearest.price, query.currency) : '—'}</dd>
                  <dd className="mt-0.5 text-xs text-ink-3">{dearest ? `leaving ${shortDay(dearest.departDate)}` : ''}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-ink-3">Near the low</dt>
                  <dd className="display mt-1 text-xl leading-tight font-bold">{plural(nearLow, 'date')}</dd>
                  <dd className="mt-0.5 text-xs text-ink-3">within 5% of the cheapest</dd>
                </div>
              </dl>
            </div>

            <div className="border-line bg-surface-2/70 p-5 max-lg:border-t sm:p-6 lg:border-l">
              <TrackBox
                input={{ flex: query }}
                watch={watch}
                currency={query.currency}
                title="Watch every date"
                blurb="Re-scan on a schedule and get alerted when a cheap fare appears, whatever the month."
                targetHint={`Optional. For example ${Math.round(cheapest.price * 0.9)} to be told about anything 10% under today's cheapest.`}
              />
            </div>
          </Card>

          <Card className="p-5 sm:p-6">
            <SectionTitle hint={`${query.tripDays != null ? `Round trips of ${plural(query.tripDays, 'night')}` : 'One-way fares'}, by the day you leave. Pick a date to see its flights.`}>
              Lowest fare by departure date
            </SectionTitle>
            <FareByDate days={days} trip={query} targetPrice={watch?.targetPrice ?? null} />
          </Card>

          <section>
            <SectionTitle hint="The cheapest date to leave in each month, and how fares run across it.">Cheapest by month</SectionTitle>
            <MonthGrid months={months} days={days} trip={query} />
          </section>

          <section>
            <SectionTitle hint="Open one to compare its flights, airlines and bags.">Cheapest dates</SectionTitle>
            <CheapestDates days={days} trip={query} />
          </section>
        </>
      )}
    </div>
  );
}

/** Results of a flexible-date search: the lowest fare for every departure date in the coming months. */
export function FlexSearch({ flex }: { flex: FlexQuery }) {
  const queryClient = useQueryClient();
  const key = keys.flex(flex);
  const search = useQuery({ queryKey: key, queryFn: () => api.flex(flex), staleTime: 5 * 60_000, retry: false });
  const refresh = useMutation({
    mutationFn: () => api.flex(flex, true),
    onSuccess: (fresh) => {
      queryClient.setQueryData(key, fresh);
      void queryClient.invalidateQueries({ queryKey: keys.meta });
    },
  });
  const { data: watches } = useQuery({ queryKey: keys.watches, queryFn: api.watches });
  const watch = watches?.find((w) => {
    const tracked = flexOfWatch(w);
    return tracked != null && sameFlex(tracked, flex);
  });

  const paramKey = JSON.stringify(flex);
  useEffect(() => {
    refresh.reset();
  }, [paramKey]); // eslint-disable-line react-hooks/exhaustive-deps -- reset only when the search changes

  if (search.isPending) {
    return (
      <div className="space-y-6" aria-busy aria-label="Pricing every departure date">
        <div>
          <Skeleton className="h-7 w-72" />
          <p className="mt-2 text-[13px] text-ink-3">Pricing every departure date in {windowLabel(flex.windowDays)}. With live fares this can take around ten seconds.</p>
        </div>
        <Skeleton className="h-44" />
        <Skeleton className="h-96" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      </div>
    );
  }
  if (search.isError) {
    return (
      <ErrorNote
        title="The search did not go through"
        message={search.error.message}
        action={
          <Button size="sm" onClick={() => void search.refetch()}>
            Try again
          </Button>
        }
      />
    );
  }
  return (
    <>
      {refresh.isError && <ErrorNote title="Could not refresh prices" message={refresh.error.message} />}
      <Results key={paramKey} result={search.data} watch={watch} onRefresh={() => refresh.mutate()} refreshing={refresh.isPending} />
    </>
  );
}
