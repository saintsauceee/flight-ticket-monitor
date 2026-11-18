import { useMemo, useState } from 'react';
import { Area, CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { AirlineSeries, HistoryPoint } from '@shared/types';
import { money } from '@/lib/format';
import { cx, Segmented } from './ui';

type Range = '7' | '30' | '90' | 'all';
type Mode = 'lowest' | 'airlines';
type View = 'chart' | 'table';

const DAY = 86_400_000;
const HOUR = 3_600_000;
/** Categorical slots. More airlines than this are listed in the table view instead of getting made-up colours. */
const SLOTS = 8;
const DEFAULT_VISIBLE = 5;
const slotColor = (slot: number) => `var(--series-${slot + 1})`;
/** A surface-coloured outline behind chart text, so it stays readable where it crosses a line. */
export const HALO = { stroke: 'var(--surface)', strokeWidth: 3, strokeLinejoin: 'round', paintOrder: 'stroke' } as const;

interface Row {
  t: number;
  lowest?: number;
  source?: HistoryPoint['source'];
  [airlineCode: string]: number | string | undefined;
}

export function niceTicks(min: number, max: number, target = 5): number[] {
  const span = max - min || Math.abs(max) * 0.1 || 1;
  const raw = span / (target - 1);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / magnitude;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * magnitude;
  const ticks: number[] = [];
  for (let v = Math.floor(min / step) * step; v <= max + step * 0.999; v += step) ticks.push(Math.round(v * 100) / 100);
  return ticks;
}

function timeTicks(from: number, to: number): { ticks: number[]; hourly: boolean } {
  const span = to - from;
  if (span < 36 * HOUR) {
    const step = [1, 2, 3, 6, 12].find((h) => span / (h * HOUR) <= 6) ?? 12;
    const start = new Date(from);
    start.setMinutes(0, 0, 0);
    const ticks: number[] = [];
    for (let t = start.getTime(); t <= to; t += step * HOUR) if (t >= from) ticks.push(t);
    return { ticks, hourly: true };
  }
  const step = [1, 2, 3, 5, 7, 10, 14, 21, 30, 60, 90].find((d) => span / (d * DAY) <= 7) ?? 180;
  const start = new Date(from);
  start.setHours(0, 0, 0, 0);
  const ticks: number[] = [];
  // Walk by calendar day so ticks stay on local midnights across DST changes.
  for (const d = start; d.getTime() <= to; d.setDate(d.getDate() + step)) if (d.getTime() >= from) ticks.push(d.getTime());
  return { ticks, hourly: false };
}

const dateTick = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const hourTick = new Intl.DateTimeFormat(undefined, { hour: 'numeric' });
const tooltipTime = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const tableTime = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

interface PlottedSeries {
  code: string;
  name: string;
  /** Short label for the end of a line. */
  short: string;
  slot: number;
  latestPrice: number | null;
}

/** What the breakdown series are: airlines of one trip, or departure months of a flexible one. */
const KINDS = {
  airline: {
    tab: 'By airline',
    group: 'Airlines shown',
    none: 'No airlines selected',
    pending: 'Per-airline prices are recorded each time this route is checked, so this chart fills in over the coming days.',
    caption: 'Cheapest fare per airline over time for this route.',
  },
  month: {
    tab: 'By month',
    group: 'Departure months shown',
    none: 'No months selected',
    pending: 'The cheapest fare for each departure month is recorded at every scan, so this chart fills in over the coming days.',
    caption: 'Cheapest fare per departure month over time for this route.',
  },
} as const;

function ChartTooltip({
  active,
  payload,
  mode,
  currency,
  series,
}: {
  active?: boolean;
  payload?: readonly { payload?: Row }[];
  mode: Mode;
  currency: string;
  series: PlottedSeries[];
}) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  const lines =
    mode === 'lowest'
      ? row.lowest == null
        ? []
        : [{ key: 'lowest', name: 'Lowest fare', value: row.lowest, color: slotColor(0) }]
      : series
          .filter((s) => typeof row[s.code] === 'number')
          .map((s) => ({ key: s.code, name: s.name, value: row[s.code] as number, color: slotColor(s.slot) }))
          .sort((a, b) => a.value - b.value);
  if (lines.length === 0) return null;
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-pop">
      <div className="mb-1.5 text-ink-3">{tooltipTime.format(row.t)}</div>
      <div className="space-y-1">
        {lines.map((line) => (
          <div key={line.key} className="flex items-center gap-2">
            <span className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: line.color }} />
            <span className="tnum text-[13px] font-semibold text-ink">{money(line.value, currency)}</span>
            <span className="text-ink-2">{line.name}</span>
          </div>
        ))}
      </div>
      {mode === 'lowest' && row.source === 'history' && <div className="mt-1.5 text-ink-3">From the provider's price history</div>}
    </div>
  );
}

export function PriceHistory({
  history,
  airlineSeries,
  typicalRange,
  targetPrice,
  currency,
  seriesKind = 'airline',
}: {
  history: readonly HistoryPoint[];
  /** The breakdown lines. For `seriesKind` "month" each one is a departure month (code "YYYY-MM"). */
  airlineSeries: readonly AirlineSeries[];
  typicalRange: [number, number] | null;
  targetPrice: number | null;
  currency: string;
  seriesKind?: keyof typeof KINDS;
}) {
  const kind = KINDS[seriesKind];
  const [range, setRange] = useState<Range>('all');
  const [mode, setMode] = useState<Mode>('lowest');
  const [view, setView] = useState<View>('chart');

  // Colour follows the airline, not its rank: slots go out in order of first
  // appearance, so an airline keeps its colour however prices reshuffle.
  const allSeries = useMemo<PlottedSeries[]>(() => {
    // Ties (airlines that showed up in the same check) go to whichever was
    // cheaper then: a fact about the past, so it never reshuffles later.
    const ordered = [...airlineSeries].sort(
      (a, b) =>
        (a.points[0]?.t ?? '').localeCompare(b.points[0]?.t ?? '') ||
        // Months have a natural order; airlines do not.
        (seriesKind === 'month' ? 0 : (a.points[0]?.price ?? 0) - (b.points[0]?.price ?? 0)) ||
        a.airline.code.localeCompare(b.airline.code),
    );
    return ordered.map((s, i) => ({
      code: s.airline.code,
      name: s.airline.name,
      short: seriesKind === 'month' ? (s.airline.name.split(' ')[0] ?? s.airline.name) : s.airline.code,
      slot: i,
      latestPrice: s.latestPrice,
    }));
  }, [airlineSeries, seriesKind]);
  const plottable = allSeries.filter((s) => s.slot < SLOTS);
  const overflow = allSeries.length - plottable.length;

  const [hidden, setHidden] = useState<Set<string>>(() => {
    const cheapest = [...plottable].sort((a, b) => (a.latestPrice ?? Infinity) - (b.latestPrice ?? Infinity)).slice(0, DEFAULT_VISIBLE);
    return new Set(plottable.filter((s) => !cheapest.includes(s)).map((s) => s.code));
  });
  const visible = plottable.filter((s) => !hidden.has(s.code));

  const lastT = history.length ? new Date((history[history.length - 1] as HistoryPoint).t).getTime() : Date.now();
  const firstT = history.length ? new Date((history[0] as HistoryPoint).t).getTime() : lastT;
  const spanDays = (lastT - firstT) / DAY;
  const cutoff = range === 'all' ? -Infinity : lastT - Number(range) * DAY;

  const rows = useMemo<Row[]>(() => {
    if (mode === 'lowest') {
      return history.map((h) => ({ t: new Date(h.t).getTime(), lowest: h.price, source: h.source })).filter((r) => r.t >= cutoff);
    }
    const byTime = new Map<number, Row>();
    for (const s of airlineSeries) {
      for (const p of s.points) {
        const t = new Date(p.t).getTime();
        if (t < cutoff) continue;
        let row = byTime.get(t);
        if (!row) byTime.set(t, (row = { t }));
        row[s.airline.code] = p.price;
      }
    }
    return [...byTime.values()].sort((a, b) => a.t - b.t);
  }, [mode, history, airlineSeries, cutoff]);

  const keys = mode === 'lowest' ? ['lowest'] : visible.map((s) => s.code);
  const values = rows.flatMap((r) => keys.map((k) => r[k]).filter((v): v is number => typeof v === 'number'));
  const hasChart = rows.length >= 2 && values.length >= 2;

  // Vertical scale: fit the data, then pull in the typical range and the
  // target when they are close enough not to flatten the line.
  let lo = values.length ? Math.min(...values) : 0;
  let hi = values.length ? Math.max(...values) : 1;
  const dataSpan = Math.max(hi - lo, hi * 0.04, 1);
  const reach = (v: number) => v >= lo - dataSpan * 1.2 && v <= hi + dataSpan * 1.2;
  const showBand = mode === 'lowest' && typicalRange != null && reach(typicalRange[0]) && reach(typicalRange[1]);
  const showTarget = targetPrice != null && reach(targetPrice);
  if (showBand && typicalRange) [lo, hi] = [Math.min(lo, typicalRange[0]), Math.max(hi, typicalRange[1])];
  if (showTarget && targetPrice != null) [lo, hi] = [Math.min(lo, targetPrice), Math.max(hi, targetPrice)];
  const pad = Math.max((hi - lo) * 0.08, 1);
  const yTicks = niceTicks(lo - pad, hi + pad);
  const yDomain: [number, number] = [yTicks[0] as number, yTicks[yTicks.length - 1] as number];
  const yWidth = Math.max(...yTicks.map((v) => money(v, currency).length)) * 6.6 + 14;

  const xDomain: [number, number] = rows.length ? [(rows[0] as Row).t, (rows[rows.length - 1] as Row).t] : [0, 1];
  const { ticks: xTicks, hourly } = timeTicks(xDomain[0], xDomain[1]);

  const lastIndex = (key: string) => rows.findLastIndex((r) => typeof r[key] === 'number');
  const lowestIndex = mode === 'lowest' ? rows.reduce((best, r, i) => ((r.lowest ?? Infinity) < ((rows[best] as Row).lowest ?? Infinity) ? i : best), 0) : -1;

  // End labels only when there are few lines and their ends are far enough apart to read.
  const ends = visible.map((s) => rows[lastIndex(s.code)]?.[s.code]).filter((v): v is number => typeof v === 'number').sort((a, b) => a - b);
  const crowded = ends.some((v, i) => i > 0 && v - (ends[i - 1] as number) < (yDomain[1] - yDomain[0]) * 0.07);
  const labelEnds = mode === 'lowest' || (visible.length <= 4 && !crowded);

  const rangeOptions = (
    [
      { value: '7', label: '7D', min: 0 },
      { value: '30', label: '30D', min: 8 },
      { value: '90', label: '90D', min: 91 },
      { value: 'all', label: 'All', min: 0 },
    ] as const
  ).filter((o) => spanDays >= o.min);

  const tableRows = [...rows].reverse();
  const tableSeries = mode === 'airlines' ? allSeries : [];

  return (
    <figure>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Segmented label="Time range" size="sm" value={range} onChange={setRange} options={rangeOptions} />
        <Segmented
          label="Series"
          size="sm"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'lowest', label: 'Lowest fare' },
            { value: 'airlines', label: kind.tab },
          ]}
        />
        <div className="ml-auto">
          <Segmented
            label="View"
            size="sm"
            value={view}
            onChange={setView}
            options={[
              { value: 'chart', label: 'Chart' },
              { value: 'table', label: 'Table' },
            ]}
          />
        </div>
      </div>

      {mode === 'airlines' && view === 'chart' && plottable.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label={kind.group}>
          {plottable.map((s) => {
            const on = !hidden.has(s.code);
            return (
              <button
                key={s.code}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  setHidden((prev) => {
                    const next = new Set(prev);
                    if (on) next.add(s.code);
                    else next.delete(s.code);
                    return next;
                  })
                }
                className={cx(
                  'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors',
                  on ? 'border-line-strong/70 bg-surface text-ink-2' : 'border-transparent bg-surface-2 text-ink-3',
                )}
              >
                <span className="h-0.5 w-3.5 rounded-full" style={{ background: on ? slotColor(s.slot) : 'var(--line-strong)' }} />
                <span className={cx('font-medium', !on && 'line-through decoration-ink-3/50')}>{s.name}</span>
                {s.latestPrice != null && <span className="tnum text-ink-3">{money(s.latestPrice, currency)}</span>}
              </button>
            );
          })}
          {overflow > 0 && <span className="self-center px-1 text-xs text-ink-3">+{overflow} more in the table view</span>}
        </div>
      )}

      {mode === 'lowest' && view === 'chart' && hasChart && (showBand || showTarget) && (
        <div className="mb-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-2">
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-3.5 rounded-full" style={{ background: slotColor(0) }} />
            Lowest fare
          </span>
          {showBand && typicalRange && (
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-3.5 rounded-[2px] bg-ink-3/25" />
              Typical range <span className="tnum text-ink-3">{money(typicalRange[0], currency)}–{money(typicalRange[1], currency)}</span>
            </span>
          )}
          {showTarget && targetPrice != null && (
            <span className="flex items-center gap-1.5">
              <span className="h-px w-3.5 bg-ink-2" />
              Your target <span className="tnum text-ink-3">{money(targetPrice, currency)}</span>
            </span>
          )}
        </div>
      )}

      {view === 'table' ? (
        <div className="max-h-[22rem] overflow-auto rounded-lg border border-line">
          <table className="w-full border-collapse text-[13px]">
            <thead className="sticky top-0 bg-surface-2 text-left text-xs text-ink-3">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  Checked
                </th>
                {mode === 'lowest' ? (
                  <>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      Lowest fare
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Source
                    </th>
                  </>
                ) : (
                  tableSeries.map((s) => (
                    <th key={s.code} scope="col" className="px-3 py-2 text-right font-medium whitespace-nowrap">
                      {s.name}
                    </th>
                  ))
                )}
              </tr>
            </thead>
            <tbody>
              {tableRows.map((row) => (
                <tr key={row.t} className="border-t border-line">
                  <td className="px-3 py-1.5 whitespace-nowrap text-ink-2">{tableTime.format(row.t)}</td>
                  {mode === 'lowest' ? (
                    <>
                      <td className="tnum px-3 py-1.5 text-right font-medium">{row.lowest != null ? money(row.lowest, currency) : '—'}</td>
                      <td className="px-3 py-1.5 text-ink-3">{row.source === 'history' ? 'Provider price history' : 'Checked by this app'}</td>
                    </>
                  ) : (
                    tableSeries.map((s) => (
                      <td key={s.code} className="tnum px-3 py-1.5 text-right">
                        {typeof row[s.code] === 'number' ? money(row[s.code] as number, currency) : <span className="text-ink-3">—</span>}
                      </td>
                    ))
                  )}
                </tr>
              ))}
              {tableRows.length === 0 && (
                <tr>
                  <td colSpan={99} className="px-3 py-6 text-center text-ink-3">
                    No observations in this range.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : !hasChart ? (
        <div className="flex h-[300px] flex-col items-center justify-center rounded-lg border border-dashed border-line-strong/70 px-6 text-center">
          <p className="font-medium">{mode === 'airlines' && plottable.length > 0 && visible.length === 0 ? kind.none : 'Not enough history to draw yet'}</p>
          <p className="mt-1 max-w-sm text-[13px] text-ink-3">{mode === 'airlines' ? kind.pending : 'The line appears after the second price check.'}</p>
        </div>
      ) : (
        <div className="h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ top: 14, right: labelEnds ? 58 : 14, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--grid)" />
              <XAxis
                dataKey="t"
                type="number"
                scale="time"
                domain={xDomain}
                ticks={xTicks}
                tickFormatter={(t: number) => (hourly ? hourTick.format(t) : dateTick.format(t))}
                tick={{ fill: 'var(--ink-3)', fontSize: 11 }}
                tickLine={false}
                tickMargin={8}
                minTickGap={28}
                interval="preserveStartEnd"
                axisLine={{ stroke: 'var(--axis)' }}
              />
              <YAxis
                domain={yDomain}
                ticks={yTicks}
                width={yWidth}
                tickFormatter={(v: number) => money(v, currency)}
                tick={{ fill: 'var(--ink-3)', fontSize: 11 }}
                tickLine={false}
                axisLine={false}
              />
              {showBand && typicalRange && (
                <ReferenceArea
                  y1={typicalRange[0]}
                  y2={typicalRange[1]}
                  fill="var(--ink-3)"
                  fillOpacity={0.1}
                  stroke="none"
                />
              )}
              {showTarget && targetPrice != null && (
                <ReferenceLine
                  y={targetPrice}
                  stroke="var(--ink-2)"
                  strokeWidth={1}
                />
              )}
              <Tooltip
                isAnimationActive={false}
                cursor={{ stroke: 'var(--line-strong)', strokeWidth: 1 }}
                content={<ChartTooltip mode={mode} currency={currency} series={visible} />}
              />
              {mode === 'lowest' && (
                <Area dataKey="lowest" type="monotone" stroke="none" fill={slotColor(0)} fillOpacity={0.1} isAnimationActive={false} activeDot={false} baseValue={yDomain[0]} />
              )}
              {(mode === 'lowest' ? [{ code: 'lowest', name: 'Lowest fare', short: '', slot: 0, latestPrice: null }] : visible).map((s) => {
                const end = lastIndex(s.code);
                return (
                  <Line
                    key={s.code}
                    dataKey={s.code}
                    name={s.name}
                    type="monotone"
                    stroke={slotColor(s.slot)}
                    strokeWidth={2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    connectNulls
                    isAnimationActive={false}
                    activeDot={{ r: 4, fill: slotColor(s.slot), stroke: 'var(--surface)', strokeWidth: 2 }}
                    dot={({ cx: x, cy: y, index, value }: { cx?: number; cy?: number; index?: number; value?: number }) => {
                      const isEnd = index === end;
                      const isLow = index === lowestIndex && !isEnd;
                      if (x == null || y == null || (!isEnd && !isLow)) return <g key={`${s.code}-${index}`} />;
                      return (
                        <g key={`${s.code}-${index}`}>
                          <circle cx={x} cy={y} r={4} fill={slotColor(s.slot)} stroke="var(--surface)" strokeWidth={2} />
                          {isEnd && labelEnds && (
                            <text x={x + 9} y={y} dy="0.35em" fontSize={11} fontWeight={600} fill="var(--ink-2)" {...HALO}>
                              {mode === 'lowest' && typeof value === 'number' ? money(value, currency) : s.short}
                            </text>
                          )}
                          {isLow && typeof value === 'number' && (
                            <text x={x} y={y + 17} textAnchor="middle" fontSize={11} fill="var(--ink-2)" {...HALO}>
                              Low {money(value, currency)}
                            </text>
                          )}
                        </g>
                      );
                    }}
                  />
                );
              })}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      <figcaption className="sr-only">
        {mode === 'lowest' ? 'Lowest fare over time for this route.' : kind.caption} Switch to the table view for the exact values.
      </figcaption>
    </figure>
  );
}
