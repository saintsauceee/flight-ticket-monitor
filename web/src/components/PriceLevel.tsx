import { ArrowDown, ArrowUp, Minus } from 'lucide-react';
import type { PriceLevel } from '@shared/types';
import { money } from '@/lib/format';
import { Badge } from './ui';

const LEVELS = {
  low: { tone: 'good', label: 'Low', Icon: ArrowDown },
  typical: { tone: 'neutral', label: 'Typical', Icon: Minus },
  high: { tone: 'bad', label: 'High', Icon: ArrowUp },
} as const;

/** "Low / Typical / High" as icon + word; the colour is a reinforcement only. */
export function LevelBadge({ level }: { level: PriceLevel }) {
  const { tone, label, Icon } = LEVELS[level];
  return (
    <Badge tone={tone}>
      <Icon className="size-3" aria-hidden />
      {label}
    </Badge>
  );
}

/** Where a price sits relative to the range that is typical for the trip. */
export function LevelMeter({ price, range, currency }: { price: number; range: [number, number]; currency: string }) {
  const [low, high] = range;
  const span = Math.max(high - low, 1);
  // Leave room on both sides so prices outside the range still land on the track.
  const min = Math.min(low - span * 0.6, price - span * 0.15);
  const max = Math.max(high + span * 0.6, price + span * 0.15);
  const pct = (value: number) => ((value - min) / (max - min)) * 100;

  return (
    <div className="w-full" role="img" aria-label={`${money(price, currency)} against a typical range of ${money(low, currency)} to ${money(high, currency)}`}>
      <div className="relative h-2.5 rounded-full bg-surface-3">
        <div className="absolute inset-y-0 rounded-full bg-ink-3/40" style={{ left: `${pct(low)}%`, width: `${pct(high) - pct(low)}%` }} />
        <div
          className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent shadow-sm ring-[3px] ring-surface"
          style={{ left: `${pct(price)}%` }}
        />
      </div>
      <div className="relative mt-1.5 h-4 text-[11px] text-ink-3">
        <span className="tnum absolute -translate-x-1/2" style={{ left: `${pct(low)}%` }}>
          {money(low, currency)}
        </span>
        <span className="tnum absolute -translate-x-1/2" style={{ left: `${pct(high)}%` }}>
          {money(high, currency)}
        </span>
      </div>
    </div>
  );
}

/** Signed change with an arrow; a falling price is the good direction. */
export function Delta({ amount, currency, suffix }: { amount: number | null; currency: string; suffix?: string }) {
  if (amount == null) return null;
  const rounded = Math.round(amount);
  if (rounded === 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-ink-3">
        <Minus className="size-3" aria-hidden />
        No change{suffix && ` ${suffix}`}
      </span>
    );
  }
  const down = rounded < 0;
  const Icon = down ? ArrowDown : ArrowUp;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${down ? 'text-good-ink' : 'text-bad-ink'}`}>
      <Icon className="size-3" aria-hidden />
      <span className="sr-only">{down ? 'Down' : 'Up'} </span>
      <span className="tnum">{money(Math.abs(rounded), currency)}</span>
      {suffix && <span className="font-normal text-ink-3"> {suffix}</span>}
    </span>
  );
}
