import { useState } from 'react';
import type { AirlineRef } from '@shared/types';
import { cx } from './ui';

// Monogram backgrounds. Each is dark enough for white text, and an airline always gets the same one.
const TINTS = ['#1d4ed8', '#0f766e', '#b45309', '#be123c', '#6d28d9', '#0369a1', '#15803d', '#c2410c'];

function tint(code: string): string {
  let hash = 0;
  for (const char of code) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return TINTS[hash % TINTS.length] as string;
}

/** The airline's logo when the provider supplies one, otherwise its two-letter code as a monogram. */
export function AirlineLogo({ airline, size = 32, className }: { airline: AirlineRef; size?: number; className?: string }) {
  const [broken, setBroken] = useState(false);
  const box = { width: size, height: size, borderRadius: Math.round(size * 0.3) };

  if (airline.logoUrl && !broken) {
    return (
      <img
        src={airline.logoUrl}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
        style={box}
        // A faint inner outline, so a logo with a white background still has an edge in both themes.
        className={cx('shrink-0 bg-white object-contain p-1 outline-1 -outline-offset-1 outline-black/10', className)}
      />
    );
  }
  return (
    <span
      aria-hidden
      style={{ ...box, fontSize: Math.round(size * 0.36), background: tint(airline.code) }}
      className={cx('display inline-flex shrink-0 items-center justify-center font-extrabold tracking-normal text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.2),inset_0_0_0_1px_rgb(0_0_0/0.1)]', className)}
    >
      {airline.code}
    </span>
  );
}
