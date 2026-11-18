import type { PricePoint } from '@shared/types';

/**
 * A word-sized trend line: the series in a quiet neutral, one value picked out
 * with an accent dot (the latest by default). No axes; the numbers live beside it.
 */
export function Sparkline({
  points,
  width = 120,
  height = 36,
  className,
  label,
  mark = 'last',
}: {
  points: readonly PricePoint[];
  width?: number;
  height?: number;
  className?: string;
  label?: string;
  /** Which point gets the dot: the newest, or the lowest. */
  mark?: 'last' | 'min';
}) {
  if (points.length < 2) {
    return <div style={{ width, height }} className={className} aria-hidden />;
  }
  const pad = 5;
  const xs = points.map((p) => new Date(p.t).getTime());
  const ys = points.map((p) => p.price);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const sx = (x: number) => pad + ((x - x0) / (x1 - x0 || 1)) * (width - pad * 2);
  const sy = (y: number) => (y1 === y0 ? height / 2 : pad + (1 - (y - y0) / (y1 - y0)) * (height - pad * 2));

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(xs[i] as number).toFixed(1)},${sy(p.price).toFixed(1)}`).join('');
  const marked = mark === 'min' ? ys.indexOf(Math.min(...ys)) : ys.length - 1;
  const lastX = sx(xs[marked] as number);
  const lastY = sy(ys[marked] as number);

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className} role="img" aria-label={label ?? 'Price trend'}>
      <path d={path} fill="none" stroke="var(--ink-3)" strokeOpacity={0.75} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lastX} cy={lastY} r={4} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />
    </svg>
  );
}
