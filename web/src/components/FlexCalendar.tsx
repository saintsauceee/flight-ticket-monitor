// Views of a flexible-date search: the lowest fare for every departure date.

import { ArrowRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { FlexDay, FlexMonth, SearchQuery } from '@shared/types';
import { day, flexDates, money, monthLabel, shortDay } from '@/lib/format';
import { searchPath } from '@/lib/query';
import { HALO, niceTicks } from './PriceHistory';
import { Delta } from './PriceLevel';
import { Sparkline } from './Sparkline';
import { Badge, cx, Segmented } from './ui';

/** Everything about the trip except its dates. */
export type TripBase = Pick<SearchQuery, 'origin' | 'destination' | 'adults' | 'cabin' | 'currency' | 'maxStops'>;

/** The ordinary search that lists the flights for one date of a flexible search. */
export function dayPath(trip: TripBase, d: FlexDay): string {
  return searchPath({ ...trip, departDate: d.departDate, returnDate: d.returnDate });
}

const stamp = (date: string) => new Date(`${date}T00:00:00`).getTime();
const monthTick = new Intl.DateTimeFormat(undefined, { month: 'short' });
const monthYearTick = new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' });
const COLOR = 'var(--series-1)';

interface Row {
  t: number;
  price: number;
  day: FlexDay;
}

function ChartTooltip({ active, payload, currency, lowest }: { active?: boolean; payload?: readonly { payload?: Row }[]; currency: string; lowest: number }) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  const over = row.price - lowest;
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-pop">
      <div className="mb-1 text-ink-3">{flexDates(row.day)}</div>
      <div className="flex items-baseline gap-2">
        <span className="tnum text-[13px] font-semibold text-ink">{money(row.price, currency)}</span>
        <span className="text-ink-2">{over <= 0 ? 'the cheapest date' : `${money(over, currency)} above the cheapest`}</span>
      </div>
      <div className="mt-1.5 text-ink-3">Click to see the flights</div>
    </div>
  );
}

/**
 * Lowest fare for each departure date. One series, so there is no legend: the
 * heading names it. Clicking a date opens the flights for it.
 */
export function FareByDate({
  days,
  trip,
  targetPrice = null,
}: {
  days: readonly FlexDay[];
  trip: TripBase;
  targetPrice?: number | null;
}) {
  const navigate = useNavigate();
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const [sort, setSort] = useState<'date' | 'price'>('date');
  const { currency } = trip;

  const rows = useMemo<Row[]>(() => days.map((d) => ({ t: stamp(d.departDate), price: d.price, day: d })), [days]);
  const prices = rows.map((r) => r.price);
  const lowest = prices.length ? Math.min(...prices) : 0;
  const lowestIndex = prices.indexOf(lowest);

  let lo = lowest;
  let hi = prices.length ? Math.max(...prices) : 1;
  const span = Math.max(hi - lo, hi * 0.04, 1);
  const showTarget = targetPrice != null && targetPrice >= lo - span * 1.2 && targetPrice <= hi + span * 1.2;
  if (showTarget && targetPrice != null) [lo, hi] = [Math.min(lo, targetPrice), Math.max(hi, targetPrice)];
  const pad = Math.max((hi - lo) * 0.08, 1);
  const yTicks = niceTicks(lo - pad, hi + pad);
  const yDomain: [number, number] = [yTicks[0] as number, yTicks[yTicks.length - 1] as number];
  const yWidth = Math.max(...yTicks.map((v) => money(v, currency).length)) * 6.6 + 14;

  const xDomain: [number, number] = rows.length ? [(rows[0] as Row).t, (rows[rows.length - 1] as Row).t] : [0, 1];
  // One tick per calendar month, on its first day.
  const xTicks = useMemo(() => {
    const ticks: number[] = [];
    const cursor = new Date(xDomain[0]);
    cursor.setDate(1);
    cursor.setHours(0, 0, 0, 0);
    for (; cursor.getTime() <= xDomain[1]; cursor.setMonth(cursor.getMonth() + 1)) if (cursor.getTime() >= xDomain[0]) ticks.push(cursor.getTime());
    return ticks;
  }, [xDomain[0], xDomain[1]]); // eslint-disable-line react-hooks/exhaustive-deps -- the two numbers are the dependency

  const tableRows = useMemo(() => (sort === 'price' ? [...rows].sort((a, b) => a.price - b.price || a.t - b.t) : rows), [rows, sort]);
  // Keep the low label inside the plot when the cheapest date sits at either edge.
  const lowAnchor = lowestIndex < rows.length * 0.08 ? 'start' : lowestIndex > rows.length * 0.92 ? 'end' : 'middle';

  return (
    <figure>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {showTarget && targetPrice != null && view === 'chart' && (
          <span className="flex items-center gap-1.5 text-xs text-ink-2">
            <span className="h-px w-3.5 bg-ink-2" />
            Your target <span className="tnum text-ink-3">{money(targetPrice, currency)}</span>
          </span>
        )}
        {view === 'table' && (
          <Segmented
            label="Sort"
            size="sm"
            value={sort}
            onChange={setSort}
            options={[
              { value: 'date', label: 'By date' },
              { value: 'price', label: 'Cheapest first' },
            ]}
          />
        )}
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

      {view === 'table' ? (
        <div className="max-h-[22rem] overflow-auto rounded-lg border border-line">
          <table className="w-full border-collapse text-[13px]">
            <thead className="sticky top-0 bg-surface-2 text-left text-xs text-ink-3">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  Depart
                </th>
                {rows.some((r) => r.day.returnDate) && (
                  <th scope="col" className="px-3 py-2 font-medium">
                    Return
                  </th>
                )}
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Lowest fare
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Above cheapest
                </th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map((row) => (
                <tr key={row.t} className="border-t border-line">
                  <td className="px-3 py-1.5 whitespace-nowrap">
                    <Link to={dayPath(trip, row.day)} className="font-medium text-accent-strong hover:underline">
                      {day(row.day.departDate)}
                    </Link>
                  </td>
                  {rows.some((r) => r.day.returnDate) && <td className="px-3 py-1.5 whitespace-nowrap text-ink-2">{row.day.returnDate ? day(row.day.returnDate) : '—'}</td>}
                  <td className="tnum px-3 py-1.5 text-right font-medium">{money(row.price, currency)}</td>
                  <td className="tnum px-3 py-1.5 text-right text-ink-3">{row.price === lowest ? 'Cheapest' : `+${money(row.price - lowest, currency)}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : rows.length < 2 ? (
        <div className="flex h-[300px] items-center justify-center rounded-lg border border-dashed border-line-strong/70 px-6 text-center text-[13px] text-ink-3">
          Not enough dates with fares to draw a chart.
        </div>
      ) : (
        <div className="h-[300px] w-full [&_.recharts-wrapper]:cursor-pointer">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={rows}
              margin={{ top: 14, right: 16, bottom: 0, left: 0 }}
              onClick={(state) => {
                const picked = rows[Number(state?.activeIndex)];
                if (picked) navigate(dayPath(trip, picked.day));
              }}
            >
              <CartesianGrid vertical={false} stroke="var(--grid)" />
              <XAxis
                dataKey="t"
                type="number"
                scale="time"
                domain={xDomain}
                ticks={xTicks}
                tickFormatter={(t: number, index: number) => (index === 0 || new Date(t).getMonth() === 0 ? monthYearTick.format(t) : monthTick.format(t))}
                tick={{ fill: 'var(--ink-3)', fontSize: 11 }}
                tickLine={false}
                tickMargin={8}
                minTickGap={12}
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
              {showTarget && targetPrice != null && <ReferenceLine y={targetPrice} stroke="var(--ink-2)" strokeWidth={1} />}
              <Tooltip
                isAnimationActive={false}
                cursor={{ stroke: 'var(--line-strong)', strokeWidth: 1 }}
                content={<ChartTooltip currency={currency} lowest={lowest} />}
              />
              <Area dataKey="price" type="linear" stroke="none" fill={COLOR} fillOpacity={0.1} isAnimationActive={false} activeDot={false} baseValue={yDomain[0]} />
              <Line
                dataKey="price"
                name="Lowest fare"
                type="linear"
                stroke={COLOR}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                isAnimationActive={false}
                activeDot={{ r: 4, fill: COLOR, stroke: 'var(--surface)', strokeWidth: 2 }}
                dot={({ cx: x, cy: y, index, value }: { cx?: number; cy?: number; index?: number; value?: number }) => {
                  if (x == null || y == null || index !== lowestIndex || typeof value !== 'number') return <g key={`dot-${index}`} />;
                  return (
                    <g key={`dot-${index}`}>
                      <circle cx={x} cy={y} r={4} fill={COLOR} stroke="var(--surface)" strokeWidth={2} />
                      <text x={x} y={y + 17} textAnchor={lowAnchor} fontSize={11} fill="var(--ink-2)" {...HALO}>
                        Low {money(value, currency)} · {shortDay((rows[index] as Row).day.departDate)}
                      </text>
                    </g>
                  );
                }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      <figcaption className="sr-only">Lowest fare for each departure date. Switch to the table view for the exact values.</figcaption>
    </figure>
  );
}

/**
 * One card per departure month: its cheapest fare, when that is, and the shape
 * of the month. Each sparkline has its own scale: it shows when in the month
 * fares dip, while the figures beside it compare the months.
 */
export function MonthGrid({ months, days, trip }: { months: readonly FlexMonth[]; days: readonly FlexDay[]; trip: TripBase }) {
  const { currency } = trip;
  const lowest = Math.min(...days.map((d) => d.price));

  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {months.map((m) => {
        const inMonth = days.filter((d) => d.departDate.startsWith(m.month));
        const isLowest = m.cheapest.price === lowest;
        return (
          <li key={m.month}>
            <Link
              to={dayPath(trip, m.cheapest)}
              title={`See the flights for ${flexDates(m.cheapest)}`}
              className={cx(
                'group flex h-full flex-col rounded-xl border bg-surface p-4 shadow-card transition-colors',
                isLowest ? 'border-accent/60 hover:border-accent' : 'border-line hover:border-line-strong',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-[13px] font-medium text-ink-2">{monthLabel(m.month)}</h3>
                {isLowest && <Badge tone="accent">Cheapest</Badge>}
              </div>
              <div className="mt-2 flex items-end justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-2xl leading-none font-semibold tracking-tight">{money(m.cheapest.price, currency)}</div>
                  <div className="mt-1.5 truncate text-xs text-ink-3">
                    {shortDay(m.cheapest.departDate)}
                    {m.cheapest.returnDate && ` – ${shortDay(m.cheapest.returnDate)}`}
                  </div>
                </div>
                <Sparkline
                  points={inMonth.map((d) => ({ t: d.departDate, price: d.price }))}
                  width={84}
                  height={36}
                  mark="min"
                  label={`Fares across ${monthLabel(m.month)}`}
                />
              </div>
              <div className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-2.5 text-xs text-ink-3">
                {m.change != null ? <Delta amount={m.change} currency={currency} suffix="since last scan" /> : <span>Typical {money(m.median, currency)}</span>}
                <ArrowRight className="size-3.5 shrink-0 transition-transform group-hover:translate-x-0.5" aria-hidden />
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** The few cheapest dates, as a list to act on. */
export function CheapestDates({ days, trip, limit = 8 }: { days: readonly FlexDay[]; trip: TripBase; limit?: number }) {
  const { currency } = trip;
  const top = useMemo(() => [...days].sort((a, b) => a.price - b.price || a.departDate.localeCompare(b.departDate)).slice(0, limit), [days, limit]);
  const lowest = top[0]?.price ?? 0;
  return (
    <ol className="divide-y divide-line rounded-xl border border-line bg-surface shadow-card">
      {top.map((d, i) => (
        <li key={d.departDate}>
          <Link to={dayPath(trip, d)} className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2/60">
            <span className="tnum w-5 shrink-0 text-xs text-ink-3">{i + 1}</span>
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{flexDates(d)}</span>
            <span className="tnum text-xs text-ink-3">{d.price === lowest ? '' : `+${money(d.price - lowest, currency)}`}</span>
            <span className="tnum w-16 text-right text-sm font-semibold">{money(d.price, currency)}</span>
            <ArrowRight className="size-3.5 shrink-0 text-ink-3" aria-hidden />
          </Link>
        </li>
      ))}
    </ol>
  );
}
