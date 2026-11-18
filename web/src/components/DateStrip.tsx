import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarSearch } from 'lucide-react';
import { Link } from 'react-router';
import type { ProviderInfo, SearchQuery } from '@shared/types';
import { api, keys } from '@/lib/api';
import { money, plural, shortDay, weekday } from '@/lib/format';
import { searchPath } from '@/lib/query';
import { Button, Card, cx, SectionTitle, Skeleton } from './ui';

const WINDOW = 3;

/**
 * Cheapest fare for each departure date around the searched one. Moving a trip
 * by a day or two is often the single biggest saving, so this sits right under
 * the headline price. Round trips keep their length.
 */
export function DateStrip({ query, provider }: { query: SearchQuery; provider: ProviderInfo }) {
  const queryClient = useQueryClient();
  const free = provider.costPerSearch === 0;
  const key = keys.calendar(query, WINDOW);

  // With a metered provider only show what is already cached; scanning is an explicit choice.
  const { data, isPending, error } = useQuery({ queryKey: key, queryFn: () => api.calendar(query, WINDOW, !free) });
  const scan = useMutation({
    mutationFn: () => api.calendar(query, WINDOW, false),
    onSuccess: (result) => {
      queryClient.setQueryData(key, result);
      void queryClient.invalidateQueries({ queryKey: keys.meta });
    },
  });

  const days = data?.days ?? [];
  const priced = days.filter((d) => d.minPrice != null);
  const missing = days.filter((d) => !d.fetched).length;
  const low = priced.length ? Math.min(...priced.map((d) => d.minPrice as number)) : null;
  const high = priced.length ? Math.max(...priced.map((d) => d.minPrice as number)) : null;
  const selected = days.find((d) => d.departDate === query.departDate);
  const saving = low != null && selected?.minPrice != null ? selected.minPrice - low : 0;

  return (
    <Card className="p-4 sm:p-5">
      <SectionTitle
        hint={
          saving > 0
            ? `Leaving on another day could save ${money(saving, query.currency)}.`
            : query.returnDate
              ? 'Each option keeps the same trip length.'
              : 'Lowest fare per departure day.'
        }
        action={
          !free &&
          missing > 0 && (
            <Button size="sm" onClick={() => scan.mutate()} loading={scan.isPending}>
              {!scan.isPending && <CalendarSearch className="size-4" aria-hidden />}
              Check nearby dates
              <span className="font-normal text-ink-3">· up to {plural(missing * provider.costPerSearch, 'search', 'searches')}</span>
            </Button>
          )
        }
      >
        Nearby dates
      </SectionTitle>

      {isPending ? (
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
          {Array.from({ length: 7 }, (_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : error ? (
        <p className="text-[13px] text-bad-ink">{error.message}</p>
      ) : (
        <ul className="grid grid-cols-4 gap-2 sm:grid-cols-7">
          {days.map((d) => {
            const isSelected = d.departDate === query.departDate;
            const isLowest = d.minPrice != null && d.minPrice === low;
            // A dot's height shows where the fare sits between the cheapest and dearest day.
            // (Position, not bar length: these prices are far from zero, so bars would mislead.)
            const level = d.minPrice == null || low == null || high == null ? null : high === low ? 50 : ((d.minPrice - low) / (high - low)) * 100;
            return (
              <li key={d.departDate}>
                <Link
                  to={searchPath({ ...query, departDate: d.departDate, returnDate: d.returnDate })}
                  aria-current={isSelected ? 'date' : undefined}
                  title={d.returnDate ? `${shortDay(d.departDate)} – ${shortDay(d.returnDate)}` : shortDay(d.departDate)}
                  className={cx(
                    'flex h-28 flex-col rounded-lg border px-2 pt-2 pb-1.5 text-center transition-colors',
                    isSelected ? 'border-accent bg-accent-soft' : 'border-line hover:border-line-strong hover:bg-surface-2',
                  )}
                >
                  <span className="text-[11px] leading-tight text-ink-3">
                    {weekday(d.departDate)} <span className="font-medium whitespace-nowrap text-ink-2 max-sm:block">{shortDay(d.departDate)}</span>
                  </span>
                  <span className="relative mx-auto mt-2 mb-2.5 w-2 flex-1" aria-hidden>
                    <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-line" />
                    {level != null && (
                      <span
                        className={cx('absolute left-0 size-2 translate-y-1/2 rounded-full ring-2 ring-surface', isLowest ? 'bg-accent' : 'bg-ink-3')}
                        style={{ bottom: `${level}%` }}
                      />
                    )}
                  </span>
                  <span className={cx('tnum text-[13px] leading-tight font-semibold', d.minPrice == null && 'font-normal text-ink-3')}>
                    {d.minPrice != null ? money(d.minPrice, query.currency) : d.fetched ? 'None' : '—'}
                  </span>
                  <span className="h-3.5 text-[10px] leading-tight font-medium text-accent-strong">{isLowest && priced.length > 1 ? 'Lowest' : ''}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {(scan.error || data?.notice || scan.data?.notice) && (
        <p className="mt-3 text-xs text-warn-ink">{scan.error?.message ?? scan.data?.notice ?? data?.notice}</p>
      )}
    </Card>
  );
}
