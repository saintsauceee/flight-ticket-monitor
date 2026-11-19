import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Compass } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { BrowserRouter, Link, Route, Routes } from 'react-router';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Layout, PageBody } from './components/Layout';
import { EmptyState, Skeleton } from './components/ui';
import { ApiRequestError } from './lib/api';
import { AlertsPage } from './pages/AlertsPage';
import { SearchPage } from './pages/SearchPage';
import { SettingsPage } from './pages/SettingsPage';
import { TrackedPage } from './pages/TrackedPage';

// Loaded on demand: this page brings the charting library with it.
const WatchPage = lazy(() => import('./pages/WatchPage').then((m) => ({ default: m.WatchPage })));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      // Client errors (bad input, not found, budget reached) will not fix themselves on retry.
      retry: (count, error) => !(error instanceof ApiRequestError && error.status >= 400 && error.status < 500) && count < 2,
    },
  },
});

function NotFound() {
  return (
    <PageBody>
      <EmptyState
        icon={<Compass className="size-5" />}
        title="Page not found"
        action={
          <Link to="/" className="text-sm font-semibold text-accent-strong hover:underline">
            Back to search
          </Link>
        }
      />
    </PageBody>
  );
}

export function App() {
  return (
    // Last resort: the page-level boundary in Layout handles almost everything.
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<SearchPage />} />
              <Route path="tracked" element={<TrackedPage />} />
              <Route
                path="tracked/:id"
                element={
                  <Suspense
                    fallback={
                      <PageBody>
                        <Skeleton className="h-96" />
                      </PageBody>
                    }
                  >
                    <WatchPage />
                  </Suspense>
                }
              />
              <Route path="alerts" element={<AlertsPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
