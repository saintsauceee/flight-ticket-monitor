import { useState } from 'react';
import type { AirlineRef } from '@shared/types';
import { cx } from './ui';

/** The airline's logo when the provider supplies one, otherwise its two-letter code as a monogram. */
export function AirlineLogo({ airline, size = 32, className }: { airline: AirlineRef; size?: number; className?: string }) {
  const [broken, setBroken] = useState(false);
  const box = { width: size, height: size };

  if (airline.logoUrl && !broken) {
    return (
      <img
        src={airline.logoUrl}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
        style={box}
        className={cx('shrink-0 rounded-md bg-white object-contain p-0.5 ring-1 ring-line', className)}
      />
    );
  }
  return (
    <span
      aria-hidden
      style={{ ...box, fontSize: Math.round(size * 0.36) }}
      className={cx('code-face inline-flex shrink-0 items-center justify-center rounded-md bg-surface-2 font-semibold text-ink-2 ring-1 ring-line', className)}
    >
      {airline.code}
    </span>
  );
}
