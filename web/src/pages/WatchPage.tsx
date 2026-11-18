import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, CircleCheck, CircleHelp, ExternalLink, Hourglass, Pause, Play, RefreshCw, Scale, Search, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { flexScanCost, type UpdateWatchInput, type Verdict, type WatchCalendar, type WatchDetail, type WatchSummary } from '@shared/types';
import { AirlineCompare } from '@/components/AirlineCompare';
import { BagPrefsControl } from '@/components/Bags';
import { dayPath, FareByDate, MonthGrid } from '@/components/FlexCalendar';
import { OfferCard, priceOffer } from '@/components/OfferCard';
import { PriceHistory } from '@/components/PriceHistory';
import { Delta, LevelBadge } from '@/components/PriceLevel';
import { Badge, Button, Card, cx, ErrorNote, inputClass, SectionTitle, Segmented, Skeleton } from '@/components/ui';
import { ApiRequestError, api, keys } from '@/lib/api';
import { dayWithYear, flexDates, money, monthLabel, plural, relativeTime, timestamp, travellers, tripDates, tripLengthLabel, windowLabel } from '@/lib/format';
import { usePrefs } from '@/lib/prefs';
import { flexOfWatch, flexPath, searchPath } from '@/lib/query';
import { useTitle } from '@/lib/useTitle';
import { AlertRow } from './AlertsPage';

/** Header actions shrink a step on phones so all four stay on one row. */
const COMPACT_ON_PHONES = 'max-sm:h-8 max-sm:px-2.5 max-sm:text-[13px]';

const VERDICTS: Record<Verdict['kind'], { Icon: typeof CircleCheck; box: string; icon: string }> = {
  buy: { Icon: CircleCheck, box: 'border-good/30 bg-good-soft', icon: 'text-good-ink' },
  fair: { Icon: Scale, box: 'border-line bg-surface', icon: 'text-ink-3' },
  wait: { Icon: Hourglass, box: 'border-warn/40 bg-warn-soft', icon: 'text-warn-ink' },
  unknown: { Icon: CircleHelp, box: 'border-line bg-surface', icon: 'text-ink-3' },
};

function VerdictCard({ verdict }: { verdict: Verdict }) {
  const { Icon, box, icon } = VERDICTS[verdict.kind];
  return (
    <div className={cx('rounded-xl border p-4 shadow-card', box)}>
      <div className="flex items-center gap-2">
        <Icon className={cx('size-5', icon)} aria-hidden />
        <h2 className="text-[15px] font-semibold tracking-tight">{verdict.headline}</h2>
      </div>
      <ul className="mt-2 space-y-1 text-[13px] text-ink-2">
        {verdict.reasons.map((reason) => (
          <li key={reason} className="flex gap-2">
            <span className="mt-[0.55em] size-1 shrink-0 rounded-full bg-ink-3" aria-hidden />
            {reason}
          </li>
        ))}
      </ul>
      {verdict.kind !== 'unknown' && <p className="mt-2.5 text-xs text-ink-3">A rule of thumb from the price history, not a forecast.</p>}
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string | null }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3 shadow-card">
      <div className="text-xs text-ink-3">{label}</div>
      <div className="mt-1 text-xl leading-tight font-semibold tracking-tight">{value}</div>
      <div className="mt-0.5 h-4 truncate text-xs text-ink-3">{sub}</div>
    </div>
  );
}

function TrackingSettings({
  detail,
  costPerCheck,
  onSave,
  saving,
}: {
  detail: WatchDetail;
  /** Provider searches one check of this trip uses. */
  costPerCheck: number;
  onSave: (patch: UpdateWatchInput) => void;
  saving: boolean;
}) {
  const { watch } = detail;
  const [target, setTarget] = useState(watch.targetPrice != null ? String(watch.targetPrice) : '');
  useEffect(() => {
    setTarget(watch.targetPrice != null ? String(watch.targetPrice) : '');
  }, [watch.targetPrice]);

  const parsed = target.trim() === '' ? null : Number(target);
  const valid = parsed == null || (Number.isFinite(parsed) && parsed > 0);
  const dirty = valid && parsed !== watch.targetPrice;
  const perMonth = Math.round((30 * 24) / watch.checkIntervalHours) * costPerCheck;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (dirty) onSave({ targetPrice: parsed });
  };

  return (
    <Card className="p-4">
      <h2 className="text-[15px] font-semibold tracking-tight">Tracking</h2>
      <form onSubmit={submit} className="mt-3">
        <label htmlFor="target-price" className="mb-1 block text-xs font-medium text-ink-3">
          Alert me at or below
        </label>
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <input
              id="target-price"
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="No target"
              aria-invalid={!valid}
              className={cx(inputClass, 'tnum h-9 pr-12')}
            />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-ink-3">{watch.query.currency}</span>
          </div>
          <Button type="submit" disabled={!dirty} loading={saving && dirty}>
            Save
          </Button>
        </div>
      </form>

      <div className="mt-4">
        <div className="mb-1 text-xs font-medium text-ink-3">Check every</div>
        <Segmented
          label="Check interval"
          size="sm"
          value={String(watch.checkIntervalHours)}
          onChange={(v) => onSave({ checkIntervalHours: Number(v) })}
          options={[...new Set([6, 12, 24, 48, watch.checkIntervalHours])].sort((a, b) => a - b).map((h) => ({ value: String(h), label: h % 24 === 0 ? `${h / 24}d` : `${h}h` }))}
        />
        <p className="mt-2 text-xs text-ink-3">
          {watch.expired
            ? 'This trip has departed and is no longer checked.'
            : !watch.active
              ? 'Paused. No checks are scheduled.'
              : watch.nextCheckAt
                ? `Next check ${relativeTime(watch.nextCheckAt)}.`
                : 'Next check pending.'}
          {costPerCheck > 0 && watch.active && !watch.expired && ` About ${plural(perMonth, 'search', 'searches')} a month.`}
        </p>
      </div>
    </Card>
  );
}

/** The actions every tracked trip has, and the bookkeeping that goes with them. */
function useWatchActions(watch: WatchSummary) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const key = keys.watch(watch.id);

  const refreshLists = () => {
    void queryClient.invalidateQueries({ queryKey: keys.watches });
    void queryClient.invalidateQueries({ queryKey: keys.alerts });
    void queryClient.invalidateQueries({ queryKey: keys.meta });
  };
  const check = useMutation({
    mutationFn: () => api.checkWatch(watch.id),
    onSuccess: (fresh) => {
      queryClient.setQueryData(key, fresh);
      refreshLists();
    },
  });
  const update = useMutation({
    mutationFn: (patch: UpdateWatchInput) => api.updateWatch(watch.id, patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: key });
      refreshLists();
    },
  });
  const remove = useMutation({
    mutationFn: () => api.deleteWatch(watch.id),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: key });
      refreshLists();
      navigate('/tracked');
    },
  });

  // Opening the page counts as having seen its alerts.
  const unread = watch.unreadAlerts;
  useEffect(() => {
    if (unread === 0) return;
    const timer = setTimeout(() => {
      void api.markAlertsRead({ watchId: watch.id }).then(() => {
        void queryClient.invalidateQueries({ queryKey: keys.alerts });
        void queryClient.invalidateQueries({ queryKey: keys.watches });
      });
    }, 1500);
    return () => clearTimeout(timer);
  }, [unread, watch.id, queryClient]);

  return { check, update, remove };
}

type WatchActions = ReturnType<typeof useWatchActions>;

function Header({
  watch,
  subtitle,
  actions,
  checkLabel,
  costPerCheck,
  searchTo,
}: {
  watch: WatchSummary;
  subtitle: ReactNode;
  actions: WatchActions;
  checkLabel: string;
  costPerCheck: number;
  /** Where "Search" goes: the same search as an ordinary results page. */
  searchTo: string;
}) {
  const { check, update, remove } = actions;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { query } = watch;
  return (
    <>
      <div>
        <Link to="/tracked" className="inline-flex items-center gap-1 text-[13px] font-medium text-ink-3 hover:text-ink">
          <ArrowLeft className="size-3.5" aria-hidden />
          Tracked trips
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <h1 className="flex flex-wrap items-center gap-x-2 text-2xl font-semibold tracking-tight">
              {watch.originAirport?.city ?? query.origin}
              <ArrowRight className="size-5 text-ink-3" aria-label="to" />
              {watch.destinationAirport?.city ?? query.destination}
            </h1>
            <p className="mt-1 text-[13px] text-ink-3">
              <span className="code-face">
                {query.origin}–{query.destination}
              </span>{' '}
              · {subtitle} · {travellers(query)}
              {query.maxStops != null && ` · ${query.maxStops === 0 ? 'nonstop only' : `up to ${plural(query.maxStops, 'stop')}`}`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={() => check.mutate()}
              loading={check.isPending}
              disabled={watch.expired}
              className={COMPACT_ON_PHONES}
              title={costPerCheck > 0 ? `Uses ${plural(costPerCheck, 'search', 'searches')}` : undefined}
            >
              {!check.isPending && <RefreshCw className="size-4" aria-hidden />}
              {checkLabel}
            </Button>
            {!watch.expired && (
              <Button onClick={() => update.mutate({ active: !watch.active })} disabled={update.isPending} className={COMPACT_ON_PHONES}>
                {watch.active ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
                {watch.active ? 'Pause' : 'Resume'}
              </Button>
            )}
            <Link
              to={searchTo}
              className={cx('inline-flex h-9 items-center gap-1.5 rounded-lg border border-line-strong/70 bg-surface px-3.5 text-sm font-medium transition-colors hover:bg-surface-2', COMPACT_ON_PHONES)}
            >
              <Search className="size-4" aria-hidden />
              Search
            </Link>
            {confirmDelete ? (
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-bad/40 bg-bad-soft py-0.5 pr-0.5 pl-3 text-[13px] text-bad-ink">
                Delete this trip and its history?
                <Button size="sm" variant="danger" onClick={() => remove.mutate()} loading={remove.isPending}>
                  Delete
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                  Cancel
                </Button>
              </span>
            ) : (
              <Button variant="ghost" aria-label="Stop tracking and delete" title="Stop tracking and delete" onClick={() => setConfirmDelete(true)} className="px-2.5">
                <Trash2 className="size-4" aria-hidden />
              </Button>
            )}
          </div>
        </div>
      </div>

      {(check.error || update.error || remove.error) && (
        <ErrorNote title="That did not work" message={(check.error ?? update.error ?? remove.error)?.message ?? ''} />
      )}
      {watch.lastError && !check.error && <ErrorNote title="The last scheduled check failed" message={`${watch.lastError} It will be retried automatically.`} />}
    </>
  );
}

function AlertList({ detail }: { detail: WatchDetail }) {
  if (detail.alerts.length === 0) return null;
  return (
    <section>
      <SectionTitle>Alerts for this trip</SectionTitle>
      <Card className="divide-y divide-line">
        {detail.alerts.slice(0, 10).map((alert) => (
          <AlertRow key={alert.id} alert={alert} linked={false} />
        ))}
      </Card>
    </section>
  );
}

function StatTiles({ detail }: { detail: WatchDetail }) {
  const { stats } = detail;
  const { currency } = detail.watch.query;
  const fmt = (n: number | null) => (n == null ? '—' : money(n, currency));
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Tile label="Lowest seen" value={fmt(stats.lowest)} sub={stats.lowestAt ? `on ${dayWithYear(stats.lowestAt)}` : null} />
      <Tile label="Average" value={fmt(stats.average)} sub={stats.current != null && stats.average != null && stats.current !== stats.average ? `now ${stats.current < stats.average ? money(stats.average - stats.current, currency) + ' below' : money(stats.current - stats.average, currency) + ' above'}` : null} />
      <Tile label="Highest seen" value={fmt(stats.highest)} sub={stats.spanDays > 0 ? `over ${plural(stats.spanDays, 'day')}` : null} />
      <Tile
        label="Cheaper than"
        value={stats.cheaperThanPct != null && stats.current != null ? `${stats.cheaperThanPct}%` : '—'}
        sub={`of ${plural(Math.max(stats.observations - 1, 0), 'earlier price')}`}
      />
    </div>
  );
}

function Detail({ detail }: { detail: WatchDetail }) {
  const { watch, stats, latest } = detail;
  const { query } = watch;
  const prefs = usePrefs();
  const [showAll, setShowAll] = useState(false);
  const actions = useWatchActions(watch);
  const fmt = (n: number | null) => (n == null ? '—' : money(n, query.currency));

  const priced = useMemo(
    () =>
      (latest?.offers ?? [])
        .map((offer) => ({ offer, pricing: priceOffer(offer, prefs.bags, query.adults) }))
        .sort((a, b) => a.pricing.total - b.pricing.total || a.offer.durationMin - b.offer.durationMin),
    [latest, prefs.bags, query.adults],
  );

  return (
    <div className="space-y-6">
      <Header watch={watch} subtitle={tripDates(query)} actions={actions} checkLabel="Check now" costPerCheck={detail.provider.costPerSearch} searchTo={searchPath(query)} />

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_19rem]">
        <Card className="flex flex-col justify-between p-4">
          <div>
            <div className="flex items-center gap-2 text-xs text-ink-3">
              Lowest fare now
              {watch.level && !watch.expired && <LevelBadge level={watch.level} />}
              {!watch.active && !watch.expired && <Badge>Paused</Badge>}
              {watch.expired && <Badge>Departed</Badge>}
            </div>
            <div className="mt-1.5 text-[3rem] leading-none font-semibold tracking-tight">{fmt(stats.current)}</div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              <Delta amount={stats.change24h} currency={query.currency} suffix="in 24h" />
              <Delta amount={stats.change7d} currency={query.currency} suffix="in 7 days" />
            </div>
          </div>
          <p className="mt-4 text-xs text-ink-3">
            {watch.cheapestAirline && stats.current != null && `Cheapest with ${watch.cheapestAirline.name} · `}
            {watch.lastCheckedAt ? `checked ${relativeTime(watch.lastCheckedAt)}` : 'not checked yet'}
          </p>
        </Card>
        <VerdictCard verdict={detail.verdict} />
        <TrackingSettings detail={detail} costPerCheck={detail.provider.costPerSearch} onSave={(patch) => actions.update.mutate(patch)} saving={actions.update.isPending} />
      </div>

      <StatTiles detail={detail} />

      <Card className="p-4 sm:p-5">
        <SectionTitle hint="Every check is recorded. Earlier points come from the data source's own price history.">Price history</SectionTitle>
        <PriceHistory
          history={detail.history}
          airlineSeries={detail.airlineSeries}
          typicalRange={detail.typicalRange}
          targetPrice={watch.targetPrice}
          currency={query.currency}
        />
      </Card>

      {latest && latest.offers.length > 0 && (
        <>
          <section>
            <SectionTitle hint={`From the check on ${timestamp(latest.fetchedAt)}.`} action={<BagPrefsControl prefs={prefs.bags} />}>
              Airlines compared
            </SectionTitle>
            <AirlineCompare offers={latest.offers} bags={prefs.bags} adults={query.adults} currency={query.currency} />
          </section>

          <section>
            <SectionTitle
              action={
                latest.externalUrl && (
                  <a href={latest.externalUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-accent-strong hover:underline">
                    Open in Google Flights
                    <ExternalLink className="size-3.5" aria-hidden />
                  </a>
                )
              }
            >
              Cheapest flights right now
            </SectionTitle>
            <div className="space-y-2.5">
              {priced.slice(0, showAll ? priced.length : 5).map(({ offer, pricing }) => (
                <OfferCard key={offer.id} offer={offer} pricing={pricing} adults={query.adults} airports={latest.airports} roundTrip={query.returnDate != null} />
              ))}
              {!showAll && priced.length > 5 && (
                <div className="pt-1 text-center">
                  <Button onClick={() => setShowAll(true)}>Show all {priced.length} flights</Button>
                </div>
              )}
            </div>
          </section>
        </>
      )}

      <AlertList detail={detail} />
    </div>
  );
}

/** Which departure months moved between the last two scans, biggest drops first. */
function MonthMoves({ calendar, currency }: { calendar: WatchCalendar; currency: string }) {
  const compared = calendar.months.filter((m) => m.change != null);
  const moved = compared.filter((m) => Math.round(m.change as number) !== 0).sort((a, b) => (a.change as number) - (b.change as number));
  return (
    <Card className="p-4">
      <h2 className="text-[15px] font-semibold tracking-tight">Since the last scan</h2>
      {compared.length === 0 ? (
        <p className="mt-2 text-[13px] text-ink-3">This is the first scan. After the next one, this shows which months got cheaper or dearer.</p>
      ) : moved.length === 0 ? (
        <p className="mt-2 text-[13px] text-ink-3">No month's cheapest fare has moved.</p>
      ) : (
        <ul className="mt-2 space-y-1.5 text-[13px]">
          {moved.slice(0, 5).map((m) => (
            <li key={m.month} className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-ink-2">{monthLabel(m.month)}</span>
              <span className="flex shrink-0 items-baseline gap-2.5">
                <Delta amount={m.change} currency={currency} />
                <span className="tnum w-14 text-right font-medium">{money(m.cheapest.price, currency)}</span>
              </span>
            </li>
          ))}
          {moved.length > 5 && <li className="text-xs text-ink-3">and {plural(moved.length - 5, 'more month')} below</li>}
        </ul>
      )}
    </Card>
  );
}

/** A trip tracked across every departure date in a rolling window. */
function FlexDetail({ detail }: { detail: WatchDetail }) {
  const { watch, stats, calendar, provider } = detail;
  const { query } = watch;
  const flex = flexOfWatch(watch);
  const actions = useWatchActions(watch);
  if (!flex) return null;
  const scanCost = calendar?.scanCost ?? flexScanCost(provider);
  const best = query.departDate && stats.current != null ? { departDate: query.departDate, returnDate: query.returnDate, price: stats.current } : null;

  return (
    <div className="space-y-6">
      <Header
        watch={watch}
        subtitle={`Any dates in ${windowLabel(flex.windowDays)} · ${tripLengthLabel(flex.tripDays)}`}
        actions={actions}
        checkLabel="Scan now"
        costPerCheck={scanCost}
        searchTo={flexPath(flex)}
      />

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_19rem]">
        <Card className="flex flex-col justify-between p-4">
          <div>
            <div className="flex items-center gap-2 text-xs text-ink-3">
              Cheapest date now
              {!watch.active && <Badge>Paused</Badge>}
            </div>
            <div className="mt-1.5 text-[3rem] leading-none font-semibold tracking-tight">{best ? money(best.price, query.currency) : '—'}</div>
            {best && <div className="mt-2 text-[13px] font-medium text-ink-2">{flexDates(best)}</div>}
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              <Delta amount={stats.change24h} currency={query.currency} suffix="in 24h" />
              <Delta amount={stats.change7d} currency={query.currency} suffix="in 7 days" />
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <p className="text-xs text-ink-3">{watch.lastCheckedAt ? `Scanned ${relativeTime(watch.lastCheckedAt)}` : 'Not scanned yet'}</p>
            {best && (
              <Link
                to={dayPath(query, best)}
                title={provider.costPerSearch > 0 ? `Uses ${plural(provider.costPerSearch, 'search', 'searches')}` : undefined}
                className="inline-flex items-center gap-1 text-[13px] font-medium text-accent-strong hover:underline"
              >
                See flights and airlines
                <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            )}
          </div>
        </Card>
        {calendar ? (
          <MonthMoves calendar={calendar} currency={query.currency} />
        ) : (
          <Card className="p-4">
            <h2 className="text-[15px] font-semibold tracking-tight">No fares yet</h2>
            <p className="mt-2 text-[13px] text-ink-3">The last scan found no fares for these dates. It is repeated on schedule.</p>
          </Card>
        )}
        <TrackingSettings detail={detail} costPerCheck={scanCost} onSave={(patch) => actions.update.mutate(patch)} saving={actions.update.isPending} />
      </div>

      <StatTiles detail={detail} />

      {calendar && (
        <>
          <Card className="p-4 sm:p-5">
            <SectionTitle hint={`From the scan on ${timestamp(calendar.scannedAt)}. Pick a date to see its flights.`}>Lowest fare by departure date</SectionTitle>
            <FareByDate days={calendar.days} trip={query} targetPrice={watch.targetPrice} />
          </Card>

          <section>
            <SectionTitle hint="The cheapest date to leave in each month, and how it moved since the scan before.">Cheapest by month</SectionTitle>
            <MonthGrid months={calendar.months} days={calendar.days} trip={query} />
          </section>
        </>
      )}

      <Card className="p-4 sm:p-5">
        <SectionTitle hint="The cheapest fare for any date at each scan. Switch to By month to follow each departure month on its own.">Price history</SectionTitle>
        <PriceHistory
          history={detail.history}
          airlineSeries={(calendar?.monthSeries ?? []).map((m) => ({ airline: { code: m.month, name: monthLabel(m.month), logoUrl: null }, points: m.points, latestPrice: m.latestPrice }))}
          seriesKind="month"
          typicalRange={null}
          targetPrice={watch.targetPrice}
          currency={query.currency}
        />
      </Card>

      <AlertList detail={detail} />
    </div>
  );
}

export function WatchPage() {
  const id = Number(useParams().id);
  const { data, isPending, error } = useQuery({
    queryKey: keys.watch(id),
    queryFn: () => api.watch(id),
    enabled: Number.isInteger(id) && id > 0,
    refetchInterval: 60_000,
    retry: (count, err) => !(err instanceof ApiRequestError && err.status === 404) && count < 2,
  });
  useTitle(data ? `${data.watch.query.origin} → ${data.watch.query.destination}` : 'Tracked trip');

  if (!Number.isInteger(id) || id <= 0 || (error instanceof ApiRequestError && error.status === 404)) {
    return (
      <ErrorNote
        title="This tracked trip does not exist"
        message="It may have been deleted."
        action={
          <Link to="/tracked" className="text-[13px] font-medium text-accent-strong hover:underline">
            Back to tracked trips
          </Link>
        }
      />
    );
  }
  if (error) return <ErrorNote message={error.message} />;
  if (isPending) {
    return (
      <div className="space-y-6" aria-busy>
        <Skeleton className="h-16 w-96 max-w-full" />
        <div className="grid gap-3 lg:grid-cols-3">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }
  return data.watch.kind === 'flex' ? <FlexDetail key={data.watch.id} detail={data} /> : <Detail key={data.watch.id} detail={data} />;
}
