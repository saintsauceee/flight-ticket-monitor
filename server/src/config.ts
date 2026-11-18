import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** Walks up from this file to the repository root (the package.json that declares workspaces). */
function findRepoRoot(): string {
  let dir = import.meta.dirname;
  for (let i = 0; i < 6; i++) {
    const pkg = path.join(dir, 'package.json');
    if (existsSync(pkg)) {
      try {
        if (JSON.parse(readFileSync(pkg, 'utf8')).workspaces) return dir;
      } catch {
        // unreadable package.json: keep walking up
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

export const REPO_ROOT = findRepoRoot();

const envFile = path.join(REPO_ROOT, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`Environment variable ${name} must be a number, got "${raw}"`);
  return n;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw);
}

const serpApiKey = process.env.SERPAPI_KEY?.trim() || null;
const requestedProvider = process.env.FLIGHT_PROVIDER?.trim().toLowerCase() || null;
if (requestedProvider && !['mock', 'serpapi'].includes(requestedProvider)) {
  throw new Error(`FLIGHT_PROVIDER must be "mock" or "serpapi", got "${requestedProvider}"`);
}
if (requestedProvider === 'serpapi' && !serpApiKey) {
  throw new Error('FLIGHT_PROVIDER=serpapi requires SERPAPI_KEY to be set');
}

const provider = (requestedProvider ?? (serpApiKey ? 'serpapi' : 'mock')) as 'mock' | 'serpapi';

const webDist = path.join(REPO_ROOT, 'web', 'dist');
// Running from TypeScript sources means development: Vite serves the web app
// there, and a leftover production build must not shadow it.
const runningFromSource = import.meta.filename.endsWith('.ts');

export const config = {
  port: num('PORT', 8787),
  host: process.env.HOST?.trim() || '127.0.0.1',
  databasePath: path.resolve(REPO_ROOT, process.env.DATABASE_PATH?.trim() || 'data/flights.db'),
  webDist,
  /** Serve the built web app from this server (production). */
  serveWeb: !runningFromSource && existsSync(path.join(webDist, 'index.html')),
  provider,
  serpapi: {
    apiKey: serpApiKey,
    /** Searches the scheduler and UI may spend per calendar month (free plan: 250). */
    monthlyBudget: num('SERPAPI_MONTHLY_BUDGET', 250),
    /** Google country used for the search; affects which fares are shown. */
    gl: process.env.SERPAPI_GL?.trim().toLowerCase() || 'us',
    /** Matches the browser exactly but is slower. */
    deepSearch: bool('SERPAPI_DEEP_SEARCH', false),
  },
  /** How often a tracked route is re-checked unless the watch overrides it. */
  checkIntervalHours: num('CHECK_INTERVAL_HOURS', provider === 'serpapi' ? 24 : 6),
  /** How long a search result is served from the local cache. */
  cacheMinutes: num('SEARCH_CACHE_MINUTES', provider === 'serpapi' ? 60 : 10),
  /** A drop of at least this many percent between two checks raises an alert. */
  dropAlertPct: num('PRICE_DROP_ALERT_PCT', 5),
  schedulerEnabled: bool('SCHEDULER_ENABLED', true),
};

export type Config = typeof config;
