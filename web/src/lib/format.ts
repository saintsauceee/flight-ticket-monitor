import type { FlexDay, SearchQuery } from '@shared/types';
import { CABIN_LABELS, FLEX_WINDOWS } from '@shared/types';

const moneyFormats = new Map<string, Intl.NumberFormat>();

export function money(amount: number, currency: string): string {
  let fmt = moneyFormats.get(currency);
  if (!fmt) {
    try {
      fmt = new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 });
    } catch {
      fmt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
    }
    moneyFormats.set(currency, fmt);
  }
  return fmt.format(Math.round(amount));
}

/** "+$12" / "−$12" */
export function signedMoney(amount: number, currency: string): string {
  if (Math.round(amount) === 0) return money(0, currency);
  return `${amount > 0 ? '+' : '−'}${money(Math.abs(amount), currency)}`;
}

export function duration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function stopsLabel(stops: number): string {
  return stops === 0 ? 'Nonstop' : stops === 1 ? '1 stop' : `${stops} stops`;
}

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const dayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const dayYearFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const shortDayFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const weekdayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const stampFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** Airport-local wall-clock stamp ("2027-01-20T18:05") -> "6:05 PM". The stamp has no zone, so it is shown as written. */
export function clock(stamp: string): string {
  return timeFormat.format(new Date(stamp));
}

/** Calendar days between the dates of two local stamps (for the "+1" next-day marker). */
export function dayShift(departAt: string, arriveAt: string): number {
  const a = Date.UTC(Number(departAt.slice(0, 4)), Number(departAt.slice(5, 7)) - 1, Number(departAt.slice(8, 10)));
  const b = Date.UTC(Number(arriveAt.slice(0, 4)), Number(arriveAt.slice(5, 7)) - 1, Number(arriveAt.slice(8, 10)));
  return Math.round((b - a) / 86_400_000);
}

const localDate = (date: string) => new Date(`${date.slice(0, 10)}T00:00:00`);

/** "2027-01-20" -> "Wed, Jan 20" */
export function day(date: string): string {
  return dayFormat.format(localDate(date));
}

export function shortDay(date: string): string {
  return shortDayFormat.format(localDate(date));
}

export function weekday(date: string): string {
  return weekdayFormat.format(localDate(date));
}

export function dayWithYear(date: string): string {
  return dayYearFormat.format(localDate(date));
}

/** ISO timestamp -> "Nov 18, 9:41 AM" in the viewer's zone. */
export function timestamp(iso: string): string {
  return stampFormat.format(new Date(iso));
}

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

export function relativeTime(iso: string, now = Date.now()): string {
  const seconds = (new Date(iso).getTime() - now) / 1000;
  const abs = Math.abs(seconds);
  if (abs < 45) return 'just now';
  if (abs < 3600) return relative.format(Math.round(seconds / 60), 'minute');
  if (abs < 86_400) return relative.format(Math.round(seconds / 3600), 'hour');
  if (abs < 86_400 * 30) return relative.format(Math.round(seconds / 86_400), 'day');
  return relative.format(Math.round(seconds / (86_400 * 30)), 'month');
}

export function tripDates(q: Pick<SearchQuery, 'departDate' | 'returnDate'>): string {
  return q.returnDate ? `${day(q.departDate)} – ${day(q.returnDate)}` : `${day(q.departDate)} · one way`;
}

/** Dates of one option of a flexible search: "Tue, Feb 23 – Tue, Mar 2", or just the day for one-way. */
export function flexDates(d: Pick<FlexDay, 'departDate' | 'returnDate'>): string {
  return d.returnDate ? `${day(d.departDate)} – ${day(d.returnDate)}` : day(d.departDate);
}

const monthFormat = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });
const monthShortFormat = new Intl.DateTimeFormat(undefined, { month: 'short' });

/** "2027-05" -> "May 2027" */
export function monthLabel(month: string): string {
  return monthFormat.format(localDate(`${month}-01`));
}

/** "2027-05" -> "May" */
export function monthShort(month: string): string {
  return monthShortFormat.format(localDate(`${month}-01`));
}

/** "the next 6 months" for a flexible search window. */
export function windowLabel(days: number): string {
  if (days === 30) return 'the next month';
  const known = FLEX_WINDOWS.find((w) => w.days === days);
  return `the next ${known ? known.label : `${days} days`}`;
}

export function tripLengthLabel(tripDays: number | null): string {
  return tripDays == null ? 'one way' : `${tripDays}-night round trip`;
}

export function travellers(q: Pick<SearchQuery, 'adults' | 'cabin'>): string {
  return `${q.adults} ${q.adults === 1 ? 'adult' : 'adults'} · ${CABIN_LABELS[q.cabin]}`;
}

export function todayString(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addDays(date: string, days: number): string {
  const d = localDate(date);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function daysBetween(from: string, to: string): number {
  return Math.round((localDate(to).getTime() - localDate(from).getTime()) / 86_400_000);
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
