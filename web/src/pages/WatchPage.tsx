import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CircleCheck, CircleHelp, ExternalLink, Hourglass, Pause, Play, RefreshCw, Scale, Search, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { flexScanCost, type UpdateWatchInput, type Verdict, type WatchCalendar, type WatchDetail, type WatchSummary } from '@shared/types';
import { AirlineCompare } from '@/components/AirlineCompare';
import { BagPrefsControl } from '@/components/Bags';
import { dayPath, FareByDate, MonthGrid } from '@/components/FlexCalendar';
import { PageBody, PageHeader } from '@/components/Layout';
import { OfferCard, priceOffer } from '@/components/OfferCard';
import { PriceHistory } from '@/components/PriceHistory';
import { Delta, LevelBadge } from '@/components/PriceLevel';
import { Badge, Button, buttonClass, Card, cx, ErrorNote, inputClass, RouteTitle, SectionTitle, Segmented, Skeleton } from '@/components/ui';
import { ApiRequestError, api, keys } from '@/lib/api';
import { dayWithYear, flexDates, money, monthLabel, plural, relativeTime, timestamp, travellers, tripDates, tripLengthLabel, windowLabel } from '@/lib/format';
import { usePrefs } from '@/lib/prefs';
import { flexOfWatch, flexPath, searchPath } from '@/lib/query';
import { useTitle } from '@/lib/useTitle';
import { AlertRow } from './AlertsPage';

/** Header actions shrink a step on phones so all four stay on one row. */
const COMPACT_ON_PHONES = 'max-sm:h-8 max-sm:rounded-lg max-sm:px-2.5 max-sm:text-[13px]';
/** With a leading icon: slightly less padding on that side, so the label looks centred. */
const WITH_ICON = `${COMPACT_ON_PHONES} sm:pl-3.5`;

const VERDICTS: Record<Verdict['kind'], { Icon: typeof CircleCheck; box: string; icon: string }> = {
  // Tinted verdicts are flat notes with a coloured edge; neutral ones are ordinary cards.
  buy: { Icon: CircleCheck, box: 'bg-good-soft ring-1 ring-good/30', icon: 'text-good-ink' },
  fair: { Icon: Scale, box: 'bg-surface shadow-card', icon: 'text-ink-3' },
  wait: { Icon: Hourglass, box: 'bg-warn-soft ring-1 ring-warn/40', icon: 'text-warn-ink' },
  unknown: { Icon: CircleHelp, box: 'bg-surface shadow-card', icon: 'text-ink-3' },
};

function VerdictCard({ verdict }: { verdict: Verdict }) {
  const { Icon, box, icon } = VERDICTS[verdict.kind];
  return (
    <div className={cx('rounded-2xl p-5', box)}>
      <div className="flex items-center gap-2.5">
        <Icon className={cx('size-5 shrink-0', icon)} aria-hidden />
        <h2 className="display text-base leading-snug font-bold">{verdict.headline}</h2>
      </div>
      <ul className="mt-3 space-y-1.5 text-[13px] text-ink-2">
        {verdict.reasons.map((reason) => (
          <li key={reason} className="flex gap-2">
            <span className="mt-[0.55em] size-1 shrink-0 rounded-full bg-ink-3" aria-hidden />
            {reason}
          </li>
        ))}
      </ul>
      {verdict.kind !== 'unknown' && <p className="mt-3 text-xs text-ink-3">A rule of thumb from the price history, not a forecast.</p>}
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string | null }) {
  return (
    <div className="rounded-2xl bg-surface px-5 py-4 shadow-card">
      <div className="text-xs font-medium text-ink-3">{label}</div>
      <div className="display mt-1.5 text-2xl leading-tight font-extrabold">{value}</div>
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
    <Card className="p-5">
      <h2 className="display text-base font-bold">Tracking</h2>
      <form onSubmit={submit} className="mt-3">
        <label htmlFor="target-price" className="mb-1.5 block text-xs font-semibold text-ink-3">
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
              className={cx(inputClass, 'tnum pr-12')}
            />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-ink-3">{watch.query.currency}</span>
          </div>
          <Button type="submit" disabled={!dirty} loading={saving && dirty}>
            Save
          </Button>
        </div>
      </form>

      <div className="mt-4">
        <div className="mb-1.5 text-xs font-semibold text-ink-3">Check every</div>
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
    <PageHeader
      back={{ to: '/tracked', label: 'Tracked trips' }}
      title={<RouteTitle from={watch.originAirport?.city ?? query.origin} to={watch.destinationAirport?.city ?? query.destination} />}
      subtitle={
        <>
          <span className="code-face">
            {query.origin}–{query.destination}
          </span>{' '}
          · {subtitle} · {travellers(query)}
          {query.maxStops != null && ` · ${query.maxStops === 0 ? 'nonstop only' : `up to ${plural(query.maxStops, 'stop')}`}`}
        </>
      }
      action={
        <>
          <Button
            variant="glass"
            onClick={() => check.mutate()}
            loading={check.isPending}
            disabled={watch.expired}
            className={WITH_ICON}
            title={costPerCheck > 0 ? `Uses ${plural(costPerCheck, 'search', 'searches')}` : undefined}
          >
            {!check.isPending && <RefreshCw className="size-4" aria-hidden />}
            {checkLabel}
          </Button>
          {!watch.expired && (
            <Button variant="glass" onClick={() => update.mutate({ active: !watch.active })} disabled={update.isPending} className={WITH_ICON}>
              {watch.active ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
              {watch.active ? 'Pause' : 'Resume'}
            </Button>
          )}
          <Link to={searchTo} className={buttonClass('glass', 'md', WITH_ICON)}>
            <Search className="size-4" aria-hidden />
            Search
          </Link>
          {confirmDelete ? (
            // A card on the band, so it follows the theme like the search form does.
            // 12px corners around 8px buttons with 4px of padding.
            <span className="off-band inline-flex items-center gap-1.5 rounded-xl bg-surface py-1 pr-1 pl-3 text-[13px] font-semibold text-bad-ink shadow-card">
              Delete this trip and its history?
              <Button size="sm" variant="destroy" onClick={() => remove.mutate()} loading={remove.isPending}>
                Delete
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
            </span>
          ) : (
            <Button variant="glass" aria-label="Stop tracking and delete" title="Stop tracking and delete" onClick={() => setConfirmDelete(true)} className={cx('sm:px-3', COMPACT_ON_PHONES)}>
              <Trash2 className="size-4" aria-hidden />
            </Button>
          )}
        </>
      }
    />
  );
}

/** What went wrong with the last action or scheduled check, if anything. */
function ActionNotes({ watch, actions }: { watch: WatchSummary; actions: WatchActions }) {
  const { check, update, remove } = actions;
  return (
    <>
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
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
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
    <>
      <Header watch={watch} subtitle={tripDates(query)} actions={actions} checkLabel="Check now" costPerCheck={detail.provider.costPerSearch} searchTo={searchPath(query)} />
      <PageBody>
      <ActionNotes watch={watch} actions={actions} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_19rem]">
        <Card className="flex flex-col justify-between p-5">
          <div>
            <div className="eyebrow flex items-center gap-2">
              Lowest fare now
              {watch.level && !watch.expired && <LevelBadge level={watch.level} />}
              {!watch.active && !watch.expired && <Badge>Paused</Badge>}
              {watch.expired && <Badge>Departed</Badge>}
            </div>
            <div className="display mt-2 text-[3.25rem] leading-none font-extrabold">{fmt(stats.current)}</div>
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

      <Card className="p-5 sm:p-6">
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
                  <a href={latest.externalUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-accent-strong hover:underline">
                    Open in Google Flights
                    <ExternalLink className="size-3.5" aria-hidden />
                  </a>
                )
              }
            >
              Cheapest flights right now
            </SectionTitle>
            <div className="space-y-3">
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
      </PageBody>
    </>
  );
}

/** Which departure months moved between the last two scans, biggest drops first. */
function MonthMoves({ calendar, currency }: { calendar: WatchCalendar; currency: string }) {
  const compared = calendar.months.filter((m) => m.change != null);
  const moved = compared.filter((m) => Math.round(m.change as number) !== 0).sort((a, b) => (a.change as number) - (b.change as number));
  return (
    <Card className="p-5">
      <h2 className="display text-base font-bold">Since the last scan</h2>
      {compared.length === 0 ? (
        <p className="mt-2 text-[13px] text-ink-3">This is the first scan. After the next one, this shows which months got cheaper or dearer.</p>
      ) : moved.length === 0 ? (
        <p className="mt-2 text-[13px] text-ink-3">No month's cheapest fare has moved.</p>
      ) : (
        <ul className="mt-3 space-y-2 text-[13px]">
          {moved.slice(0, 5).map((m) => (
            <li key={m.month} className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-ink-2">{monthLabel(m.month)}</span>
              <span className="flex shrink-0 items-baseline gap-2.5">
                <Delta amount={m.change} currency={currency} />
                <span className="tnum w-16 text-right font-semibold">{money(m.cheapest.price, currency)}</span>
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
    <>
      <Header
        watch={watch}
        subtitle={`Any dates in ${windowLabel(flex.windowDays)} · ${tripLengthLabel(flex.tripDays)}`}
        actions={actions}
        checkLabel="Scan now"
        costPerCheck={scanCost}
        searchTo={flexPath(flex)}
      />
      <PageBody>
      <ActionNotes watch={watch} actions={actions} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_19rem]">
        <Card className="flex flex-col justify-between p-5">
          <div>
            <div className="eyebrow flex items-center gap-2">
              Cheapest date now
              {!watch.active && <Badge>Paused</Badge>}
            </div>
            <div className="display mt-2 text-[3.25rem] leading-none font-extrabold">{best ? money(best.price, query.currency) : '—'}</div>
            {best && <div className="mt-2 text-sm font-semibold text-ink-2">{flexDates(best)}</div>}
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
                className="inline-flex items-center gap-1 text-[13px] font-semibold text-accent-strong hover:underline"
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
          <Card className="p-5">
            <h2 className="display text-base font-bold">No fares yet</h2>
            <p className="mt-2 text-[13px] text-ink-3">The last scan found no fares for these dates. It is repeated on schedule.</p>
          </Card>
        )}
        <TrackingSettings detail={detail} costPerCheck={scanCost} onSave={(patch) => actions.update.mutate(patch)} saving={actions.update.isPending} />
      </div>

      <StatTiles detail={detail} />

      {calendar && (
        <>
          <Card className="p-5 sm:p-6">
            <SectionTitle hint={`From the scan on ${timestamp(calendar.scannedAt)}. Pick a date to see its flights.`}>Lowest fare by departure date</SectionTitle>
            <FareByDate days={calendar.days} trip={query} targetPrice={watch.targetPrice} />
          </Card>

          <section>
            <SectionTitle hint="The cheapest date to leave in each month, and how it moved since the scan before.">Cheapest by month</SectionTitle>
            <MonthGrid months={calendar.months} days={calendar.days} trip={query} />
          </section>
        </>
      )}

      <Card className="p-5 sm:p-6">
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
      </PageBody>
    </>
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
      <PageBody>
        <ErrorNote
          title="This tracked trip does not exist"
          message="It may have been deleted."
          action={
            <Link to="/tracked" className="text-[13px] font-semibold text-accent-strong hover:underline">
              Back to tracked trips
            </Link>
          }
        />
      </PageBody>
    );
  }
  if (error) {
    return (
      <PageBody>
        <ErrorNote message={error.message} />
      </PageBody>
    );
  }
  if (isPending) {
    return (
      <>
        <PageHeader back={{ to: '/tracked', label: 'Tracked trips' }} title="Tracked trip" subtitle="Loading its prices…" />
        <PageBody>
          <div className="space-y-6" aria-busy>
            <div className="grid gap-4 lg:grid-cols-3">
              <Skeleton className="h-44" />
              <Skeleton className="h-44" />
              <Skeleton className="h-44" />
            </div>
            <Skeleton className="h-96" />
          </div>
        </PageBody>
      </>
    );
  }
  return data.watch.kind === 'flex' ? <FlexDetail key={data.watch.id} detail={data} /> : <Detail key={data.watch.id} detail={data} />;
}
