import { ArrowUp, Backpack, Luggage, Plane, Target } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { addDays, money, shortDay, todayString } from '@/lib/format';
import { usePrefs } from '@/lib/prefs';
import { AirlineLogo } from './AirlineLogo';
import { Delta, LevelBadge } from './PriceLevel';
import { Badge, Button, cx } from './ui';

/*
 * The landing page below the search form: what the app does, in three steps
 * told as you scroll down a flight route.
 *
 * The scroll effects are decoration (see "Landing page scroll effects" in
 * index.css). Each picture is three layers that drift apart slightly as it
 * crosses the screen, and a plane rides the route line. Scrolling itself is
 * never altered, nothing is pinned, and the text does not depend on any of it:
 * with reduced motion, or in a browser without scroll-driven animations, this
 * is an ordinary still page.
 *
 * The pictures are drawn from made-up numbers, and each one says "Example".
 */

/** Lowest fare per departure date across six months: dear at short notice, a dip a few months out. */
const FARES = [
  742, 705, 668, 690, 640, 612, 588, 601, 560, 572, 541, 529, 548, 512, 498, 505, 471, 427, 452, 466, 449, 478, 463, 492, 474, 501, 485, 519, 498, 532, 511, 547, 526, 560, 538,
  571, 552, 590, 566, 598,
];
const WINDOW_DAYS = 180;

/** A tracked trip's price over a month of checks, ending under the target. */
const HISTORY = [396, 401, 392, 388, 395, 404, 398, 391, 386, 393, 399, 390, 384, 389, 381, 386, 378, 383, 376, 380, 372, 377, 369, 374, 366, 371, 363, 367, 359, 354];
const TYPICAL: [number, number] = [372, 398];
const TARGET = 360;

/** Invented carriers: the cheapest fare is the dearest total once a bag is added. */
const AIRLINES = [
  { code: 'JN', name: 'Juniper Air', fare: 412, bags: 0 },
  { code: 'KA', name: 'Kestrel Airways', fare: 371, bags: 96 },
  { code: 'TA', name: 'Tidewater Air', fare: 349, bags: 140 },
];

/** A series scaled into a box, as SVG paths plus the scale that made them. */
function plot(values: readonly number[], domain: [number, number], width: number, height: number) {
  const [low, high] = domain;
  const x = (i: number) => (i / (values.length - 1)) * width;
  const y = (v: number) => (1 - (v - low) / (high - low)) * height;
  const line = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  return { x, y, line, area: `${line}L${width},${height}L0,${height}Z` };
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length / 2;
  return sorted.length % 2 ? (sorted[Math.floor(mid)] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/** One picture. Its layers share this element's scroll position, so they move as a set. */
function Scene({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <figure role="img" aria-label={label} className={cx('story-scene story-reveal relative mx-auto w-full max-w-[30rem]', className)}>
      {children}
    </figure>
  );
}

/**
 * A layer of a picture. `drift` is how far, in pixels, it sits from its resting
 * place when the picture enters the screen; it passes through rest at mid-screen
 * and ends the same distance the other way. Positive runs ahead of the scroll
 * (nearer), negative lags behind it (farther).
 */
function Layer({ drift, className, children }: { drift: number; className?: string; children?: ReactNode }) {
  return (
    <div className={cx('story-layer', className)} style={{ '--drift': `${drift}px` } as CSSProperties}>
      {children}
    </div>
  );
}

/**
 * The main card of a picture with a small card hanging from its bottom edge.
 * The small card overlaps the main one by 12px at rest and drifts 16px either
 * way, so it only ever covers the main card's bottom padding (32px), never its content.
 */
function Stack({ card, chip, chipClassName }: { card: ReactNode; chip: ReactNode; chipClassName: string }) {
  return (
    <div className="relative">
      <div className="relative rounded-2xl bg-surface px-5 pt-5 pb-8 shadow-card">{card}</div>
      <Layer drift={16} className={cx('absolute top-full -mt-3 rounded-2xl bg-surface shadow-lift', chipClassName)}>
        {chip}
      </Layer>
    </div>
  );
}

/** A dot marker on a chart, placed by percentage so it keeps its size when the chart scales. */
function Marker({ left, top }: { left: number; top: number }) {
  return <span className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent ring-2 ring-surface" style={{ left: `${left}%`, top: `${top}%` }} />;
}

function DatesScene({ currency }: { currency: string }) {
  const W = 400;
  const H = 132;
  const lowest = Math.min(...FARES);
  const at = FARES.indexOf(lowest);
  const chart = plot(FARES, [lowest - 40, Math.max(...FARES) + 20], W, H);
  const depart = todayString(Math.round((at / (FARES.length - 1)) * WINDOW_DAYS));
  const below = Math.round((1 - lowest / median(FARES)) * 100);
  const monthName = new Intl.DateTimeFormat(undefined, { month: 'short' });
  const months = Array.from({ length: 6 }, (_, i) => {
    const date = new Date();
    date.setDate(1);
    date.setMonth(date.getMonth() + i);
    return monthName.format(date);
  });

  return (
    <Scene label="Example: a chart of the lowest fare for each departure date over six months, with the cheapest date marked." className="pt-6 pr-6 pb-24">
      <Layer drift={-20} className="absolute top-0 right-0 bottom-16 left-12 rounded-2xl bg-accent-soft" />
      <Stack
        chipClassName="left-5 px-4 py-3.5"
        chip={
          <>
            <div className="eyebrow">Cheapest date</div>
            <div className="mt-1.5 flex items-center gap-2.5">
              <span className="display text-2xl leading-none font-extrabold">{money(lowest, currency)}</span>
              <Badge tone="good">{below}% below typical</Badge>
            </div>
            <div className="mt-1.5 text-xs font-semibold text-ink-2">
              {shortDay(depart)} – {shortDay(addDays(depart, 7))}
            </div>
          </>
        }
        card={
          <>
            <div className="eyebrow">Example · lowest fare by date</div>
            <div className="relative mt-4">
              <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full overflow-visible" fill="none">
                <defs>
                  <linearGradient id="story-fare-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--series-1)" stopOpacity={0.22} />
                    <stop offset="100%" stopColor="var(--series-1)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                {[0.25, 0.5, 0.75].map((f) => (
                  <line key={f} x1={0} x2={W} y1={H * f} y2={H * f} stroke="var(--grid)" vectorEffect="non-scaling-stroke" />
                ))}
                <path d={chart.area} fill="url(#story-fare-fill)" />
                <path d={chart.line} stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                <line x1={0} x2={W} y1={H} y2={H} stroke="var(--axis)" vectorEffect="non-scaling-stroke" />
              </svg>
              <Marker left={(chart.x(at) / W) * 100} top={(chart.y(lowest) / H) * 100} />
            </div>
            <div className="mt-2 flex justify-between text-[11px] text-ink-3">
              {months.map((month, i) => (
                <span key={i}>{month}</span>
              ))}
            </div>
          </>
        }
      />
    </Scene>
  );
}

function AirlinesScene({ currency }: { currency: string }) {
  const totals = AIRLINES.map((a) => a.fare + a.bags);
  const most = Math.max(...totals);
  const least = Math.min(...totals);

  return (
    <Scene label="Example: three airlines compared on fare plus bag fees. The lowest fare has the highest total once a bag is added." className="pt-6 pb-20 pl-6">
      <Layer drift={-20} className="absolute top-0 right-12 bottom-14 left-0 rounded-2xl bg-accent-soft" />
      <Stack
        chipClassName="right-5 px-4 py-3.5"
        chip={
          <>
            <div className="eyebrow">Your bags</div>
            <div className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-ink-2">
              <span className="inline-flex h-6 items-center gap-1 rounded-full bg-ink/[0.07] px-2">
                <Backpack className="size-3.5" />1 carry-on
              </span>
              <span className="inline-flex h-6 items-center gap-1 rounded-full bg-ink/[0.07] px-2">
                <Luggage className="size-3.5" />1 checked
              </span>
            </div>
          </>
        }
        card={
          <>
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
              <div className="eyebrow">Example · total with your bags</div>
              <div className="flex items-center gap-3 text-[11px] text-ink-2">
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-[2px] bg-(--series-1)" />
                  Fare
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-[2px] bg-(--series-2)" />
                  Bag fees
                </span>
              </div>
            </div>
            <ul className="mt-4 space-y-4">
              {AIRLINES.map((airline) => {
                const total = airline.fare + airline.bags;
                return (
                  <li key={airline.code} className="flex items-center gap-3">
                    <AirlineLogo airline={{ code: airline.code, name: airline.name, logoUrl: null }} size={32} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="truncate text-sm font-semibold">{airline.name}</span>
                        <span className={cx('tnum text-sm font-bold', total === least && 'text-good-ink')}>{money(total, currency)}</span>
                      </div>
                      {/* Fare then bag fees, to one scale, with a gap between the two parts. */}
                      <div className="mt-1.5 flex h-2 gap-0.5">
                        <span className={cx('bg-(--series-1)', airline.bags === 0 && 'rounded-r-[4px]')} style={{ width: `${(airline.fare / most) * 100}%` }} />
                        {airline.bags > 0 && <span className="rounded-r-[4px] bg-(--series-2)" style={{ width: `${(airline.bags / most) * 100}%` }} />}
                      </div>
                      <div className="mt-1 text-xs text-ink-3">
                        {airline.bags > 0 ? `${money(airline.fare, currency)} fare + ${money(airline.bags, currency)} bag` : 'Bag included in the fare'}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        }
      />
    </Scene>
  );
}

function TrackingScene({ currency }: { currency: string }) {
  const W = 400;
  const H = 120;
  const chart = plot(HISTORY, [346, 408], W, H);
  const now = HISTORY[HISTORY.length - 1] as number;
  const weekAgo = HISTORY[HISTORY.length - 8] as number;

  return (
    <Scene label="Example: the price history of a tracked trip, falling below the target price, and the alert that follows." className="pt-6 pr-6 pb-20">
      <Layer drift={-20} className="absolute top-0 right-0 bottom-14 left-12 rounded-2xl bg-accent-soft" />
      <Stack
        chipClassName="right-6 left-5 flex items-start gap-3 p-3.5 sm:right-auto sm:w-80"
        chip={
          <>
            <span className="flex size-9 shrink-0 items-center justify-center rounded-control bg-good-soft text-good-ink">
              <Target className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Target reached</p>
              <p className="mt-0.5 text-xs text-ink-3">
                Now {money(now, currency)}, under your {money(TARGET, currency)} target.
              </p>
            </div>
            <span className="mt-1.5 size-2 shrink-0 rounded-full bg-accent" />
          </>
        }
        card={
          <>
            <div className="flex items-center justify-between gap-3">
              <div className="eyebrow">Example · tracked trip</div>
              <LevelBadge level="low" />
            </div>
            <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="display text-4xl leading-none font-extrabold">{money(now, currency)}</span>
              <Delta amount={now - weekAgo} currency={currency} suffix="in 7 days" />
            </div>
            <div className="relative mt-4">
              <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full overflow-visible" fill="none">
                <rect x={0} width={W} y={chart.y(TYPICAL[1])} height={chart.y(TYPICAL[0]) - chart.y(TYPICAL[1])} fill="var(--ink-3)" fillOpacity={0.14} />
                <line x1={0} x2={W} y1={chart.y(TARGET)} y2={chart.y(TARGET)} stroke="var(--ink-2)" vectorEffect="non-scaling-stroke" />
                <path d={chart.line} stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
              </svg>
              <Marker left={100} top={(chart.y(now) / H) * 100} />
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-2">
              <span className="flex items-center gap-1.5">
                <span className="h-0.5 w-3 rounded-full bg-(--series-1)" />
                Lowest fare
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-3 rounded-[2px] bg-ink-3/25" />
                Typical range
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-px w-3 bg-ink-2" />
                Your target <span className="tnum text-ink-3">{money(TARGET, currency)}</span>
              </span>
            </div>
          </>
        }
      />
    </Scene>
  );
}

/** One step: words on one side of the route, its picture on the other. `flip` swaps the sides on wide screens. */
function Chapter({ step, kicker, title, children, scene, flip = false }: { step: string; kicker: string; title: string; children: ReactNode; scene: ReactNode; flip?: boolean }) {
  return (
    <li className="relative grid items-center gap-y-8 pl-10 lg:grid-cols-2 lg:gap-x-32 lg:pl-0">
      {/* The stop on the route. It fills in once the plane has passed it. */}
      <span aria-hidden className="absolute top-1 left-3.5 size-2.5 -translate-x-1/2 rounded-full bg-page ring-2 ring-line-strong lg:top-1/2 lg:left-1/2 lg:-translate-y-1/2">
        <span className="story-reached absolute inset-0 rounded-full bg-accent ring-2 ring-accent" />
      </span>
      <div className={cx('story-reveal max-w-md', flip && 'lg:col-start-2 lg:row-start-1')}>
        <p className="eyebrow">
          <span className="tnum text-accent-strong">{step}</span> · {kicker}
        </p>
        <h3 className="display mt-3 text-2xl leading-tight font-extrabold sm:text-[1.75rem]">{title}</h3>
        <p className="mt-3 text-[15px] leading-relaxed text-ink-2">{children}</p>
      </div>
      <div className={cx('min-w-0', flip && 'lg:col-start-1 lg:row-start-1')}>{scene}</div>
    </li>
  );
}

/** Back to the search form, with the cursor in its first field. */
function toSearch() {
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: 0, behavior: calm ? 'auto' : 'smooth' });
  document.querySelector<HTMLInputElement>('main input[role="combobox"]')?.focus({ preventScroll: true });
}

export function LandingStory() {
  const { currency } = usePrefs();

  return (
    <section aria-labelledby="story-title" className="pt-6 sm:pt-10">
      <header className="story-reveal mx-auto max-w-2xl text-center">
        <p className="eyebrow">How it works</p>
        <h2 id="story-title" className="display mt-3 text-3xl leading-tight font-extrabold sm:text-4xl">
          From a route to the right day to book
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-[15px] leading-relaxed text-ink-2">
          It prices every date, adds in your bags, and keeps watching the fare after you close the tab.
        </p>
      </header>

      <div className="relative mt-8 pt-16 pb-16 lg:mt-10 lg:pt-24 lg:pb-24">
        {/* The route: a dashed line, the stretch already flown drawn solid over it. */}
        <div aria-hidden className="pointer-events-none absolute inset-y-0 left-3.5 w-px -translate-x-1/2 lg:left-1/2">
          <span className="absolute inset-0 border-l border-dashed border-line-strong" />
          {/* Where the flight starts. */}
          <span className="absolute top-0 left-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent ring-4 ring-accent/20" />
          <span className="story-progress absolute inset-y-0 -left-px w-0.5 rounded-full bg-accent" />
        </div>
        {/* The plane holds mid-screen while the route scrolls under it, so it flies the line at the reader's own pace. */}
        <div aria-hidden className="pointer-events-none absolute top-3 bottom-0 left-3.5 z-10 w-7 -translate-x-1/2 lg:left-1/2">
          <span className="sticky top-[calc(50dvh-0.875rem)] flex size-7 items-center justify-center rounded-full bg-accent text-white shadow-btn">
            <Plane className="size-3.5 rotate-[135deg]" />
          </span>
        </div>

        <ol className="space-y-20 lg:space-y-28">
          <Chapter step="01" kicker="Search" title="See every date's lowest fare at once" scene={<DatesScene currency={currency} />}>
            Pick a route and a trip length. One search prices every departure day for the months ahead, so the cheap weeks stand out before you commit to dates.
          </Chapter>
          <Chapter step="02" kicker="Compare" title="Compare what you will really pay" scene={<AirlinesScene currency={currency} />} flip>
            Say which bags you bring and every total includes their fees. Airlines then line up side by side on price, legroom, Wi-Fi, fare rules and emissions.
          </Chapter>
          <Chapter step="03" kicker="Track" title="Keep watching until the price is right" scene={<TrackingScene currency={currency} />}>
            Track a trip, with or without fixed dates. Every check is recorded, so you can see how the fare moves, and you get an alert when it reaches your target or sets a new
            low.
          </Chapter>
        </ol>
      </div>

      {/*
        The end of the route leads back to the one thing to do on this page. The
        panel is about half a screen tall so that the page can scroll far enough
        for the plane, which sits mid-screen, to reach the end of the line.
      */}
      <div className="on-band relative flex min-h-[calc(50dvh-3rem)] items-center justify-center overflow-hidden rounded-4xl bg-band px-6 py-12 text-center text-white sm:py-16">
        <div aria-hidden className="band-art pointer-events-none absolute inset-0" />
        <div className="story-reveal relative">
          <h2 className="display text-3xl leading-tight font-extrabold sm:text-4xl">Start with a route</h2>
          <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-white/70">Enter where you are flying from and to. Any dates is the quickest way to find a cheap week.</p>
          <Button variant="primary" size="lg" className="mt-7 sm:pr-4" onClick={toSearch}>
            Search flights
            <ArrowUp className="size-4" strokeWidth={2.5} aria-hidden />
          </Button>
        </div>
      </div>
    </section>
  );
}
