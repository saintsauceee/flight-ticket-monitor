import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BellPlus, BellRing } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import type { CreateWatchInput, WatchSummary } from '@shared/types';
import { api, keys } from '@/lib/api';
import { money, relativeTime } from '@/lib/format';
import { Button, cx, inputClass } from './ui';

/** Starts tracking a search (fixed or flexible dates), or says it is already tracked. */
export function TrackBox({
  input,
  watch,
  currency,
  title,
  blurb,
  targetHint,
}: {
  /** What to track; the optional target price is added to it. */
  input: Pick<CreateWatchInput, 'query' | 'flex'>;
  /** The existing watch for this search, if there is one. */
  watch: WatchSummary | undefined;
  currency: string;
  title: string;
  blurb: string;
  /** Tooltip on the target field, e.g. a suggested amount. */
  targetHint?: string;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [target, setTarget] = useState('');

  const track = useMutation({
    mutationFn: () => api.createWatch({ ...input, targetPrice: target.trim() ? Number(target) : null }),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: keys.watches });
      void queryClient.invalidateQueries({ queryKey: keys.meta });
      navigate(`/tracked/${created.id}`);
    },
  });

  if (watch) {
    return (
      <div className="flex h-full flex-col justify-center gap-2">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <BellRing className="size-4 text-accent" aria-hidden />
          You are tracking this trip
        </p>
        <p className="text-[13px] text-ink-3">
          {watch.lastCheckedAt ? `Last checked ${relativeTime(watch.lastCheckedAt)}.` : 'First check pending.'}
          {watch.targetPrice != null && ` Target ${money(watch.targetPrice, watch.query.currency)}.`}
        </p>
        <Link to={`/tracked/${watch.id}`} className="text-[13px] font-medium text-accent-strong hover:underline">
          View price history →
        </Link>
      </div>
    );
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (target.trim() && !(Number(target) > 0)) return;
    track.mutate();
  };

  return (
    <form onSubmit={submit} className="flex h-full flex-col justify-center gap-2.5">
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-0.5 text-[13px] text-ink-3">{blurb}</p>
      </div>
      <div className="flex gap-2">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Target price in {currency} (optional)</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="Target price"
            title={targetHint ?? 'Optional'}
            className={cx(inputClass, 'tnum h-9 pr-12')}
          />
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-ink-3">{currency}</span>
        </label>
        <Button type="submit" variant="primary" loading={track.isPending}>
          {!track.isPending && <BellPlus className="size-4" aria-hidden />}
          Track
        </Button>
      </div>
      {track.error && <p className="text-xs font-medium text-bad-ink">{track.error.message}</p>}
    </form>
  );
}
