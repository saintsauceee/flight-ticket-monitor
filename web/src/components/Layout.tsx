import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Bell, FlaskConical, Moon, Plane, Sun } from 'lucide-react';
import type { ReactNode } from 'react';
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

/** The centred column every page lines up on. */
export function Container({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('mx-auto w-full max-w-6xl px-4 sm:px-6', className)}>{children}</div>;
}

/**
 * The navy strip under the navigation. It carries each page's heading, and the
 * search form on the search page. It stays navy in both themes, so its content
 * uses white text rather than the ink tokens.
 */
export function Band({ children, className, art }: { children: ReactNode; className?: string; /** Decoration drawn behind the content. */ art?: ReactNode }) {
  return (
    // Not clipped itself: the airport picker's list hangs below the band. Raised so that list covers the page content.
    <section className="on-band relative z-20 bg-band text-white">
      <div className="band-art pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        {art}
      </div>
      <Container className={cx('relative', className)}>{children}</Container>
    </section>
  );
}

/** A page's title block, on the band. */
export function PageHeader({
  title,
  subtitle,
  action,
  back,
  narrow = false,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  back?: { to: string; label: string };
  /** Match a page whose content is a narrow column. */
  narrow?: boolean;
}) {
  return (
    <Band className="py-7 sm:py-9">
      <div className={cx('flex flex-wrap items-end justify-between gap-x-6 gap-y-4', narrow && 'mx-auto max-w-3xl')}>
        <div className="min-w-0">
          {back && (
            <Link to={back.to} className="mb-2 inline-flex items-center gap-1 text-[13px] font-semibold text-white/60 transition-colors hover:text-white">
              <ArrowLeft className="size-3.5" aria-hidden />
              {back.label}
            </Link>
          )}
          <h1 className="display text-[1.75rem] leading-tight font-extrabold sm:text-[2rem]">{title}</h1>
          {subtitle && <p className="mt-1.5 max-w-2xl text-sm text-white/65">{subtitle}</p>}
        </div>
        {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
      </div>
    </Band>
  );
}

/** The part of a page below the band. */
export function PageBody({ children, className, narrow = false }: { children: ReactNode; className?: string; narrow?: boolean }) {
  return (
    <Container className="py-6 sm:py-8">
      <div className={cx('space-y-6', narrow && 'mx-auto max-w-3xl', className)}>{children}</div>
    </Container>
  );
}

const NAV = [
  { to: '/', label: 'Search', end: true },
  { to: '/tracked', label: 'Tracked', end: false },
  { to: '/settings', label: 'Settings', end: false },
];

// 40px on a pointer, 44px on phones: the smallest comfortable touch target.
const ICON_BUTTON = 'relative flex size-11 items-center justify-center rounded-full transition-colors sm:size-10';

export function Layout() {
  const { data: meta } = useMeta();
  const { data: alerts } = useAlerts();
  const theme = useResolvedTheme();
  const location = useLocation();
  const unread = alerts?.unread ?? 0;

  return (
    <div className="flex min-h-dvh flex-col">
      {/* Keyboard users can jump past the navigation; it shows only when focused. */}
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-control focus:bg-surface focus:px-4 focus:py-2.5 focus:text-sm focus:font-semibold focus:text-ink focus:shadow-pop"
      >
        Skip to content
      </a>
      <header className="on-band sticky top-0 z-30 border-b border-white/[0.07] bg-band text-white">
        <Container className="flex h-16 items-center gap-1 sm:gap-2">
          <Link to="/" className="flex items-center gap-2.5 rounded-lg py-1 sm:mr-5 sm:pr-2">
            <span className="flex size-8 items-center justify-center rounded-[10px] bg-accent text-white shadow-btn">
              <Plane className="size-[18px] -rotate-45" aria-hidden />
            </span>
            <span className="display text-[17px] font-extrabold max-sm:sr-only">Flight Monitor</span>
          </Link>

          <nav className="flex items-center gap-0.5" aria-label="Main">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cx(
                    'tap-target rounded-full px-2.5 py-2 text-sm leading-5 font-semibold transition-colors sm:px-3.5',
                    isActive ? 'bg-white/[0.13] text-white' : 'text-white/60 hover:bg-white/[0.07] hover:text-white',
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center sm:gap-1">
            {meta?.provider.demo && (
              <Link
                to="/settings"
                title="Prices, schedules and bag fees are simulated, not real fares. Open Settings to connect a live source."
                className="mr-1 inline-flex h-7 items-center gap-1.5 rounded-full bg-amber-400/15 px-2.5 text-xs font-semibold text-amber-200 ring-1 ring-amber-300/25 transition-colors ring-inset hover:bg-amber-400/25"
              >
                <FlaskConical className="size-3.5" aria-hidden />
                <span className="max-sm:sr-only">Demo data</span>
              </Link>
            )}
            <NavLink
              to="/alerts"
              aria-label={unread > 0 ? `Alerts, ${unread} unread` : 'Alerts'}
              className={({ isActive }) => cx(ICON_BUTTON, isActive ? 'bg-white/[0.13] text-white' : 'text-white/65 hover:bg-white/[0.07] hover:text-white')}
            >
              <Bell className="size-[18px]" aria-hidden />
              {unread > 0 && (
                <span className="tnum absolute top-0.5 right-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] leading-none font-bold text-on-accent ring-2 ring-band">
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </NavLink>
            <button
              type="button"
              aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              onClick={() => setPrefs({ theme: theme === 'dark' ? 'light' : 'dark' })}
              // Phones: the bar has no room for it; the same choice is on the Settings page.
              className={cx(ICON_BUTTON, 'text-white/65 hover:bg-white/[0.07] hover:text-white max-sm:hidden')}
            >
              {theme === 'dark' ? <Sun className="size-[18px]" aria-hidden /> : <Moon className="size-[18px]" aria-hidden />}
            </button>
          </div>
        </Container>
      </header>

      <main id="content" className="flex-1">
        {/* A crash in one page leaves the navigation usable; moving to another page clears it. */}
        <ErrorBoundary resetKey={location.pathname + location.search}>
          <Outlet />
        </ErrorBoundary>
      </main>

      <footer>
        <Container className="pb-8 text-xs text-ink-3">
          {meta && (
            <span>
              Data source: {meta.provider.label}
              {meta.provider.demo && ' (simulated prices, not real fares)'}
              {meta.usage.budget != null && ` · ${meta.usage.used} of ${meta.usage.budget} searches used this month`}
            </span>
          )}
        </Container>
      </footer>
    </div>
  );
}
