import type { Ctx } from '../context';
import { checkWatch, dueWatchIds } from './watches';

export interface Scheduler {
  /** Runs one pass now. Resolves with the number of watches checked. */
  tick(): Promise<number>;
  stop(): void;
}

/**
 * Re-checks tracked routes when they come due. Watches are processed one at a
 * time, a few per pass, so a backlog (for example after the app was off for a
 * while) is worked through gently instead of bursting requests at the provider.
 */
export function startScheduler(ctx: Ctx, options: { intervalMs?: number; batch?: number; log?: (line: string) => void } = {}): Scheduler {
  const { intervalMs = 60_000, batch = 3, log = console.log } = options;
  let running = false;

  const tick = async (): Promise<number> => {
    if (running) return 0;
    running = true;
    let checked = 0;
    try {
      for (const id of dueWatchIds(ctx, batch)) {
        try {
          await checkWatch(ctx, id, 'scheduled');
          checked++;
        } catch (err) {
          // checkWatch has already stored the error and scheduled a retry.
          log(`[scheduler] watch ${id}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    } finally {
      running = false;
    }
    return checked;
  };

  const first = setTimeout(() => void tick(), 3_000);
  const timer = setInterval(() => void tick(), intervalMs);
  first.unref();
  timer.unref();

  return {
    tick,
    stop() {
      clearTimeout(first);
      clearInterval(timer);
    },
  };
}
