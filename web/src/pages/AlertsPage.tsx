import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BellOff, CheckCheck, Target, TrendingDown, Trophy } from 'lucide-react';
import { Link } from 'react-router';
import type { Alert, AlertKind } from '@shared/types';
import { PageBody, PageHeader, useAlerts } from '@/components/Layout';
import { Button, Card, cx, EmptyState, ErrorNote, Skeleton } from '@/components/ui';
import { api, keys } from '@/lib/api';
import { relativeTime, timestamp, tripDates } from '@/lib/format';
import { useTitle } from '@/lib/useTitle';

const KINDS: Record<AlertKind, { Icon: typeof Target; label: string }> = {
  target_hit: { Icon: Target, label: 'Target reached' },
  new_low: { Icon: Trophy, label: 'New low' },
  price_drop: { Icon: TrendingDown, label: 'Price drop' },
};

export function AlertRow({ alert, linked = true }: { alert: Alert; linked?: boolean }) {
  const { Icon, label } = KINDS[alert.kind] ?? KINDS.price_drop;
  const unread = alert.readAt == null;
  const body = (
    <div className="flex items-start gap-3.5 px-4 py-3.5 sm:px-5">
      <span className={cx('mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-control', unread ? 'bg-good-soft text-good-ink' : 'bg-ink/[0.06] text-ink-3')}>
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className={cx('text-sm', unread ? 'font-semibold text-ink' : 'text-ink-2')}>{alert.message}</p>
        <p className="mt-0.5 text-xs text-ink-3">
          {label}
          {linked && ` · ${alert.route.departDate ? tripDates(alert.route) : 'any dates'}`}
          {alert.route.flexible && ' · flexible dates'} · <span title={timestamp(alert.createdAt)}>{relativeTime(alert.createdAt)}</span>
        </p>
      </div>
      {unread && <span className="mt-2 size-2 shrink-0 rounded-full bg-accent" role="img" aria-label="Unread" />}
    </div>
  );
  return linked ? (
    <Link to={`/tracked/${alert.watchId}`} className="block transition-colors first:rounded-t-2xl last:rounded-b-2xl hover:bg-surface-2">
      {body}
    </Link>
  ) : (
    body
  );
}

export function AlertsPage() {
  useTitle('Alerts');
  const queryClient = useQueryClient();
  const { data, isPending, error } = useAlerts();
  const markAll = useMutation({
    mutationFn: () => api.markAlertsRead(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.alerts });
      void queryClient.invalidateQueries({ queryKey: keys.watches });
    },
  });

  return (
    <>
      <PageHeader
        narrow
        title="Alerts"
        subtitle="Raised when a tracked trip reaches your target, sets a new low, or drops sharply between checks. For trips with flexible dates, also when any month's cheapest fare drops."
        action={
          (data?.unread ?? 0) > 0 && (
            <Button variant="glass" onClick={() => markAll.mutate()} loading={markAll.isPending} className="sm:pl-3.5">
              {!markAll.isPending && <CheckCheck className="size-4" aria-hidden />}
              Mark all read
            </Button>
          )
        }
      />
      <PageBody narrow>

      {error ? (
        <ErrorNote message={error.message} />
      ) : isPending ? (
        <Skeleton className="h-48" />
      ) : data.alerts.length === 0 ? (
        <EmptyState icon={<BellOff className="size-5" />} title="No alerts yet">
          Alerts appear here as tracked prices move. Set a target price on a tracked trip to be told the moment it is reached.
        </EmptyState>
      ) : (
        <Card className="divide-y divide-line">
          {data.alerts.map((alert) => (
            <AlertRow key={alert.id} alert={alert} />
          ))}
        </Card>
      )}
      </PageBody>
    </>
  );
}
