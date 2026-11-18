import type { Alert, AlertKind, FlexDay } from '@shared/types';
import type { Ctx } from '../context';
import { parseDate } from '../lib/dates';
import { cheapestDay, monthMoves } from './flex';

export interface AlertDraft {
  kind: AlertKind;
  price: number;
  previousPrice: number | null;
  message: string;
  /** The dates the alert is about, for flexible trips. */
  departDate?: string;
  returnDate?: string | null;
}

export interface AlertInput {
  /** e.g. "JFK → LHR" */
  route: string;
  current: number;
  /** Price at the previous observation, if any. */
  previous: number | null;
  /** Lowest price seen before this check. */
  lowestBefore: number | null;
  priorObservations: number;
  targetPrice: number | null;
  /** Minimum drop between two checks, in percent, that is worth an alert. */
  dropPct: number;
  format: (amount: number) => string;
}

/** Decides which alerts a newly observed price deserves. Pure, so it is easy to test. */
export function evaluateAlerts(input: AlertInput): AlertDraft[] {
  const { route, current, previous, lowestBefore, priorObservations, targetPrice, dropPct, format } = input;
  const drafts: AlertDraft[] = [];

  // Fire when the price crosses to or below the target, not on every check that stays there.
  if (targetPrice != null && current <= targetPrice && (previous == null || previous > targetPrice)) {
    drafts.push({
      kind: 'target_hit',
      price: current,
      previousPrice: previous,
      message: `${route} is now ${format(current)}, at or below your ${format(targetPrice)} target.`,
    });
  }

  const newLow = lowestBefore != null && priorObservations >= 3 && current < lowestBefore;
  if (newLow) {
    drafts.push({
      kind: 'new_low',
      price: current,
      previousPrice: lowestBefore,
      message: `${route} hit a new low of ${format(current)}, ${format((lowestBefore as number) - current)} under the previous low.`,
    });
  } else if (previous != null && previous > 0 && current <= previous * (1 - dropPct / 100)) {
    const pct = Math.round(((previous - current) / previous) * 100);
    drafts.push({
      kind: 'price_drop',
      price: current,
      previousPrice: previous,
      message: `${route} fell ${pct}% to ${format(current)} (was ${format(previous)}).`,
    });
  }
  return drafts;
}

const shortDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const monthName = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' });

/** "Feb 23 – Mar 2", or "Feb 23" for one-way. */
export function formatDates(day: Pick<FlexDay, 'departDate' | 'returnDate'>): string {
  const out = shortDate.format(parseDate(day.departDate));
  return day.returnDate ? `${out} – ${shortDate.format(parseDate(day.returnDate))}` : out;
}

export interface FlexAlertInput {
  /** e.g. "JFK → LHR" */
  route: string;
  /** Fares per departure date from the scan just made. */
  current: readonly FlexDay[];
  /** The same from the scan before it; empty when there is none. */
  previous: readonly FlexDay[];
  /** Lowest fare for any date seen before this scan. */
  lowestBefore: number | null;
  priorScans: number;
  targetPrice: number | null;
  dropPct: number;
  format: (amount: number) => string;
}

/**
 * Alerts for a trip with flexible dates. Besides the target and the all-time
 * low, it watches each departure month on its own: a fare that appears in May
 * is worth knowing about even while February stays the cheapest month overall.
 */
export function evaluateFlexAlerts(input: FlexAlertInput): AlertDraft[] {
  const { route, current, previous, lowestBefore, priorScans, targetPrice, dropPct, format } = input;
  const best = cheapestDay(current);
  if (!best) return [];
  const bestBefore = cheapestDay(previous);
  const drafts: AlertDraft[] = [];
  const dated = (day: FlexDay) => ({ departDate: day.departDate, returnDate: day.returnDate });

  if (targetPrice != null && best.price <= targetPrice && (!bestBefore || bestBefore.price > targetPrice)) {
    drafts.push({
      kind: 'target_hit',
      price: best.price,
      previousPrice: bestBefore?.price ?? null,
      message: `${route} from ${format(best.price)} on ${formatDates(best)}, at or below your ${format(targetPrice)} target.`,
      ...dated(best),
    });
  }

  const newLow = lowestBefore != null && priorScans >= 3 && best.price < lowestBefore;
  if (newLow) {
    drafts.push({
      kind: 'new_low',
      price: best.price,
      previousPrice: lowestBefore,
      message: `${route}: new low of ${format(best.price)} for ${formatDates(best)}, ${format((lowestBefore as number) - best.price)} under the lowest seen before.`,
      ...dated(best),
    });
  }

  const drops = monthMoves(current, previous)
    .filter((m) => m.previous.price > 0 && m.current.price <= m.previous.price * (1 - dropPct / 100))
    // The new low already announced that month's fare.
    .filter((m) => !(newLow && m.current.departDate === best.departDate))
    .map((m) => ({ ...m, pct: Math.round(((m.previous.price - m.current.price) / m.previous.price) * 100) }))
    .sort((a, b) => b.pct - a.pct || a.month.localeCompare(b.month));
  const lead = drops[0];
  if (lead) {
    const name = (month: string) => monthName.format(parseDate(`${month}-01`));
    const others = drops.slice(1, 4).map((m) => `${name(m.month)} −${m.pct}%`);
    drafts.push({
      kind: 'price_drop',
      price: lead.current.price,
      previousPrice: lead.previous.price,
      message:
        `${route}: cheapest ${name(lead.month)} fare fell ${lead.pct}% to ${format(lead.current.price)} (${formatDates(lead.current)}), was ${format(lead.previous.price)}.` +
        (others.length ? ` Also down: ${others.join(', ')}.` : ''),
      ...dated(lead.current),
    });
  }
  return drafts;
}

interface AlertRow {
  id: number;
  watch_id: number;
  kind: AlertKind;
  price: number;
  previous_price: number | null;
  message: string;
  created_at: string;
  read_at: string | null;
  depart_date: string | null;
  return_date: string | null;
  origin: string;
  destination: string;
  watch_kind: string;
  watch_depart_date: string;
  watch_return_date: string | null;
  currency: string;
}

const SELECT = `
  SELECT a.*, w.origin, w.destination, w.kind AS watch_kind, w.depart_date AS watch_depart_date, w.return_date AS watch_return_date, w.currency
  FROM alerts a JOIN watches w ON w.id = a.watch_id`;

function toAlert(row: AlertRow): Alert {
  const flexible = row.watch_kind === 'flex';
  return {
    id: row.id,
    watchId: row.watch_id,
    kind: row.kind,
    price: row.price,
    previousPrice: row.previous_price,
    currency: row.currency,
    message: row.message,
    createdAt: row.created_at,
    readAt: row.read_at,
    route: {
      origin: row.origin,
      destination: row.destination,
      departDate: flexible ? (row.depart_date ?? '') : row.watch_depart_date,
      returnDate: flexible ? row.return_date : row.watch_return_date,
      flexible,
    },
  };
}

export function insertAlerts(ctx: Ctx, watchId: number, drafts: readonly AlertDraft[], at: string): void {
  const insert = ctx.db.prepare(
    'INSERT INTO alerts (watch_id, kind, price, previous_price, message, created_at, depart_date, return_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  );
  for (const d of drafts) insert.run(watchId, d.kind, d.price, d.previousPrice, d.message, at, d.departDate ?? null, d.returnDate ?? null);
}

export function listAlerts(ctx: Ctx, options: { watchId?: number; limit?: number } = {}): Alert[] {
  const limit = options.limit ?? 100;
  const rows = (
    options.watchId != null
      ? ctx.db.prepare(`${SELECT} WHERE a.watch_id = ? ORDER BY a.created_at DESC, a.id DESC LIMIT ?`).all(options.watchId, limit)
      : ctx.db.prepare(`${SELECT} ORDER BY a.created_at DESC, a.id DESC LIMIT ?`).all(limit)
  ) as AlertRow[];
  return rows.map(toAlert);
}

export function unreadAlertCount(ctx: Ctx): number {
  return (ctx.db.prepare('SELECT COUNT(*) AS n FROM alerts WHERE read_at IS NULL').get() as { n: number }).n;
}

/** Marks alerts as read: the given ids, one watch's alerts, or everything. Returns how many changed. */
export function markAlertsRead(ctx: Ctx, target: { ids?: number[]; watchId?: number }): number {
  const now = ctx.now().toISOString();
  if (target.ids?.length) {
    const placeholders = target.ids.map(() => '?').join(',');
    return ctx.db.prepare(`UPDATE alerts SET read_at = ? WHERE read_at IS NULL AND id IN (${placeholders})`).run(now, ...target.ids).changes;
  }
  if (target.watchId != null) {
    return ctx.db.prepare('UPDATE alerts SET read_at = ? WHERE read_at IS NULL AND watch_id = ?').run(now, target.watchId).changes;
  }
  return ctx.db.prepare('UPDATE alerts SET read_at = ? WHERE read_at IS NULL').run(now).changes;
}
