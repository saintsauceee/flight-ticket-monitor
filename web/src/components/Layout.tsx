import { useQuery } from '@tanstack/react-query';
import { Bell, FlaskConical, Moon, Plane, Sun } from 'lucide-react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { api, keys } from '@/lib/api';
import { setPrefs, useResolvedTheme } from '@/lib/prefs';
import { ErrorBoundary } from './ErrorBoundary';
import { cx } from './ui';

export function useMeta() {
  return useQuery({ queryKey: keys.meta, queryFn: api.meta, staleTime: 30_000 });
}

export function useAlerts() {
  return useQuery({ queryKey: keys.alerts, queryFn: api.alerts, refetchInterval: 60_000 });
}

const NAV = [
  { to: '/', label: 'Search', end: true },
  { to: '/tracked', label: 'Tracked', end: false },
  { to: '/settings', label: 'Settings', end: false },
];

export function Layout() {
  const { data: meta } = useMeta();
  const { data: alerts } = useAlerts();
  const theme = useResolvedTheme();
  const location = useLocation();
  const unread = alerts?.unread ?? 0;

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-20 border-b border-line bg-surface/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-1 px-4 sm:gap-2 sm:px-6">
          <Link to="/" className="mr-2 flex items-center gap-2 rounded-lg py-1 pr-2 font-semibold tracking-tight sm:mr-4">
            <span className="flex size-7 items-center justify-center rounded-lg bg-accent text-on-accent">
              <Plane className="size-4 -rotate-45" aria-hidden />
            </span>
            <span className="max-sm:sr-only">Flight Monitor</span>
          </Link>

          <nav className="flex items-center gap-0.5" aria-label="Main">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cx(
                    'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                    isActive ? 'bg-surface-2 text-ink' : 'text-ink-3 hover:bg-surface-2/70 hover:text-ink',
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-1">
            <NavLink
              to="/alerts"
              aria-label={unread > 0 ? `Alerts, ${unread} unread` : 'Alerts'}
              className={({ isActive }) =>
                cx(
                  'relative flex size-9 items-center justify-center rounded-lg transition-colors',
                  isActive ? 'bg-surface-2 text-ink' : 'text-ink-3 hover:bg-surface-2 hover:text-ink',
                )
              }
            >
              <Bell className="size-[18px]" aria-hidden />
              {unread > 0 && (
                <span className="tnum absolute top-1 right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] leading-none font-semibold text-on-accent ring-2 ring-surface">
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </NavLink>
            <button
              type="button"
              aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              onClick={() => setPrefs({ theme: theme === 'dark' ? 'light' : 'dark' })}
              className="flex size-9 items-center justify-center rounded-lg text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
            >
              {theme === 'dark' ? <Sun className="size-[18px]" aria-hidden /> : <Moon className="size-[18px]" aria-hidden />}
            </button>
          </div>
        </div>

        {meta?.provider.demo && (
          <div className="border-t border-warn/30 bg-warn-soft">
            <p className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-1.5 text-xs text-warn-ink sm:px-6">
              <FlaskConical className="size-3.5 shrink-0" aria-hidden />
              <span>
                <strong className="font-semibold">Demo data.</strong> Prices, schedules and bag fees are simulated, not real fares.{' '}
                <Link to="/settings" className="font-medium underline underline-offset-2">
                  Connect a live source
                </Link>
              </span>
            </p>
          </div>
        )}
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        {/* A crash in one page leaves the navigation usable; moving to another page clears it. */}
        <ErrorBoundary resetKey={location.pathname + location.search}>
          <Outlet />
        </ErrorBoundary>
      </main>

      <footer className="mx-auto w-full max-w-6xl px-4 pb-8 text-xs text-ink-3 sm:px-6">
        {meta && (
          <span>
            Data source: {meta.provider.label}
            {meta.usage.budget != null && ` · ${meta.usage.used} of ${meta.usage.budget} searches used this month`}
          </span>
        )}
      </footer>
    </div>
  );
}
