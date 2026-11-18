const DAY_MS = 86_400_000;

/** Local calendar date of `d` as YYYY-MM-DD. */
export function toDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parses YYYY-MM-DD as midnight UTC. */
export function parseDate(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

export function isValidDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const d = parseDate(date);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date;
}

export function addDays(date: string, days: number): string {
  return new Date(parseDate(date).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (both YYYY-MM-DD). */
export function daysBetween(from: string, to: string): number {
  return Math.round((parseDate(to).getTime() - parseDate(from).getTime()) / DAY_MS);
}

/** Days (fractional) from the instant `now` until midnight UTC of `date`. */
export function daysUntil(date: string, now: Date): number {
  return (parseDate(date).getTime() - now.getTime()) / DAY_MS;
}

/** Day of week for a YYYY-MM-DD date, 0 = Sunday. */
export function dayOfWeek(date: string): number {
  return parseDate(date).getUTCDay();
}

/** "YYYY-MM-DDTHH:mm" for a date plus minutes after its midnight (may roll over days). */
export function localStamp(date: string, minutesFromMidnight: number): string {
  const d = new Date(parseDate(date).getTime() + minutesFromMidnight * 60_000);
  return d.toISOString().slice(0, 16);
}

export function currentMonth(now: Date = new Date()): string {
  return now.toISOString().slice(0, 7);
}
