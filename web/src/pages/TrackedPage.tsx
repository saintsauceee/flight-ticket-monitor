import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, Pause, Radar, Search, Target } from 'lucide-react';
import { Link } from 'react-router';
import type { WatchSummary } from '@shared/types';
import { useMeta } from '@/components/Layout';
import { Delta, LevelBadge } from '@/components/PriceLevel';
import { Sparkline } from '@/components/Sparkline';
import { Badge, Button, cx, EmptyState, ErrorNote, Skeleton } from '@/components/ui';
import { api, keys } from '@/lib/api';
import { addDays, money, plural, relativeTime, shortDay, todayString, travellers, tripDates, windowLabel } from '@/lib/format';
import { usePrefs } from '@/lib/prefs';
import { useTitle } from '@/lib/useTitle';

function WatchCard({ watch }: { watch: WatchSummary }) {
  const { query, flex } = watch;
  // A flexible trip has no dates of its own; `query` carries the cheapest ones found.
  const cheapestDates = flex && query.departDate ? `${shortDay(query.departDate)}${query.returnDate ? ` – ${shortDay(query.returnDate)}` : ''}` : null;
  const change = watch.currentPrice != null && watch.previousPrice != null ? watch.currentPrice - watch.previousPrice : null;
  const atLowest = watch.currentPrice != null && watch.lowestPrice != null && watch.observations > 3 && watch.currentPrice <= watch.lowestPrice;
  const targetMet = watch.targetPrice != null && watch.currentPrice != null && watch.currentPrice <= watch.targetPrice;

  return (
    <Link
      to={`/tracked/${watch.id}`}
      className={cx(
        'group flex flex-col rounded-xl border border-line bg-surface p-4 shadow-card transition-colors hover:border-line-strong',
        (watch.expired || !watch.active) && 'opacity-75',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-1.5 text-[15px] font-semibold tracking-tight">
            <span className="truncate">{watch.originAirport?.city ?? query.origin}</span>
            <ArrowRight className="size-3.5 shrink-0 text-ink-3" aria-label="to" />
            <span className="truncate">{watch.destinationAirport?.city ?? query.destination}</span>
          </h3>
          <p className="mt-0.5 truncate text-xs text-ink-3">
            <span className="code-face">
              {query.origin}–{query.destination}
            </span>{' '}
            · {flex ? `Any dates in ${windowLabel(flex.windowDays)}` : tripDates(query)}
          </p>
        </div>
        {watch.unreadAlerts > 0 && <Badge tone="accent">{watch.unreadAlerts} new</Badge>}
      </div>

      <div className="mt-4 flex items-end justify-between gap-3">
        <div>
          <div className="text-[1.75rem] leading-none font-semibold tracking-tight">
            {watch.currentPrice != null ? money(watch.currentPrice, query.currency) : <span className="text-ink-3">—</span>}
          </div>
          <div className="mt-1.5 flex h-4 items-center gap-2">
            {change != null ? <Delta amount={change} currency={query.currency} suffix={flex ? 'since last scan' : 'since last check'} /> : <span className="text-xs text-ink-3">{watch.currentPrice == null ? 'No fares on the last check' : 'First observation'}</span>}
          </div>
        </div>
        <Sparkline points={watch.spark} width={116} height={40} label={`Price trend over ${watch.spark.length} observations`} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {watch.expired ? (
          <Badge>Departed</Badge>
        ) : !watch.active ? (
          <Badge>
            <Pause className="size-3" aria-hidden />
            Paused
          </Badge>
        ) : (
          watch.level && <LevelBadge level={watch.level} />
        )}
        {atLowest && !watch.expired && <Badge tone="good">Lowest seen</Badge>}
        {watch.targetPrice != null && (
          <Badge tone={targetMet ? 'good' : 'neutral'}>
            <Target className="size-3" aria-hidden />
            {targetMet ? 'Target met' : `Target ${money(watch.targetPrice, query.currency)}`}
          </Badge>
        )}
        {watch.lastError && (
          <Badge tone="warn" title={watch.lastError}>
            <AlertTriangle className="size-3" aria-hidden />
            Check failed
          </Badge>
        )}
      </div>

      <dl className="mt-3.5 grid grid-cols-3 gap-2 border-t border-line pt-3 text-xs">
        <div>
          <dt className="text-ink-3">Lowest seen</dt>
          <dd className="tnum mt-0.5 font-medium text-ink-2">{watch.lowestPrice != null ? money(watch.lowestPrice, query.currency) : '—'}</dd>
        </div>
        <div>
          <dt className="text-ink-3">Average</dt>
          <dd className="tnum mt-0.5 font-medium text-ink-2">{watch.averagePrice != null ? money(watch.averagePrice, query.currency) : '—'}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-ink-3">{flex ? 'Cheapest dates' : 'Cheapest now'}</dt>
          <dd className="mt-0.5 truncate font-medium text-ink-2">{flex ? (cheapestDates ?? '—') : (watch.cheapestAirline?.name ?? '—')}</dd>
        </div>
      </dl>
      <p className="mt-2.5 text-[11px] text-ink-3">
        {travellers(query)}
        {flex && ` · ${flex.tripDays != null ? plural(flex.tripDays, 'night') : 'one way'}`} · {watch.lastCheckedAt ? `checked ${relativeTime(watch.lastCheckedAt)}` : 'not checked yet'}
      </p>
    </Link>
  );
}

const SAMPLE_ROUTES: [string, string, number, number | null][] = [
  ['JFK', 'LHR', 50, 7],
  ['SFO', 'NRT', 75, 12],
  ['LHR', 'BCN', 24, 4],
  ['SIN', 'BKK', 38, null],
];

export function TrackedPage() {
  useTitle('Tracked');
  const prefs = usePrefs();
  const queryClient = useQueryClient();
  const { data: meta } = useMeta();
  const { data: watches, isPending, error } = useQuery({ queryKey: keys.watches, queryFn: api.watches, refetchInterval: 60_000 });

  const addSamples = useMutation({
    mutationFn: async () => {
      // One trip with flexible dates, then a few with fixed ones.
      await api.createWatch({ flex: { origin: 'JFK', destination: 'LHR', tripDays: 7, windowDays: 180, adults: 1, cabin: 'economy', currency: prefs.currency, maxStops: null } });
      for (const [origin, destination, inDays, length] of SAMPLE_ROUTES) {
        const departDate = todayString(inDays);
        await api.createWatch({
          query: { origin, destination, departDate, returnDate: length ? addDays(departDate, length) : null, adults: 1, cabin: 'economy', currency: prefs.currency, maxStops: null },
        });
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.watches }),
  });

  const live = watches?.filter((w) => !w.expired) ?? [];
  const past = watches?.filter((w) => w.expired) ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Tracked trips</h1>
          <p className="mt-0.5 text-[13px] text-ink-3">
            {meta ? `Each trip is re-checked on its own schedule (every ${meta.defaultCheckIntervalHours} hours by default) and every price is kept.` : ' '}
          </p>
        </div>
        <Link to="/" className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-sm font-medium text-on-accent shadow-sm transition hover:brightness-110">
          <Search className="size-4" aria-hidden />
          Track another trip
        </Link>
      </div>

      {error ? (
        <ErrorNote message={error.message} />
      ) : isPending ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-60" />
          ))}
        </div>
      ) : watches.length === 0 ? (
        <EmptyState
          icon={<Radar className="size-5" />}
          title="Nothing tracked yet"
          action={
            <>
              <Link to="/" className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-sm font-medium text-on-accent shadow-sm transition hover:brightness-110">
                Search for a trip
              </Link>
              {meta?.provider.demo && (
                <Button onClick={() => addSamples.mutate()} loading={addSamples.isPending}>
                  Add sample trips
                </Button>
              )}
            </>
          }
        >
          Search for a trip and choose <strong className="font-medium text-ink-2">Track</strong>. Its price is then recorded on a schedule, so you can see how it moves and get alerted when
          it drops. Search with <strong className="font-medium text-ink-2">Any dates</strong> to watch every departure date at once.
          {addSamples.error && <span className="mt-2 block font-medium text-bad-ink">{addSamples.error.message}</span>}
        </EmptyState>
      ) : (
        <>
          {live.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {live.map((w) => (
                <WatchCard key={w.id} watch={w} />
              ))}
            </div>
          )}
          {past.length > 0 && (
            <section>
              <h2 className="mb-3 text-[13px] font-medium text-ink-3">Departed</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {past.map((w) => (
                  <WatchCard key={w.id} watch={w} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
