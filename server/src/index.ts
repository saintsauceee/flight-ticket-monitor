import { serve } from '@hono/node-server';
import { createApp } from './app';
import { config } from './config';
import type { Ctx } from './context';
import { airportCount } from './data/airports';
import { openDatabase } from './db';
import { createProvider } from './providers';
import { startScheduler } from './services/scheduler';

const ctx: Ctx = {
  db: openDatabase(config.databasePath),
  provider: createProvider(config),
  config,
  now: () => new Date(),
};

const app = createApp(ctx);
const scheduler = config.schedulerEnabled ? startScheduler(ctx) : null;

const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  const url = `http://${config.host}:${info.port}`;
  console.log(config.serveWeb ? `Flight Monitor running at ${url}` : `Flight Monitor API on ${url} (the web app is served by Vite in development)`);
  console.log(`  data source : ${ctx.provider.info.label}${ctx.provider.info.demo ? ' (simulated prices; set SERPAPI_KEY for real fares)' : ''}`);
  console.log(`  database    : ${config.databasePath}`);
  console.log(`  airports    : ${airportCount()}`);
  console.log(`  re-checks   : ${scheduler ? `every ${config.checkIntervalHours}h per tracked route` : 'disabled'}`);
});

function shutdown() {
  scheduler?.stop();
  server.close(() => {
    ctx.db.close();
    process.exit(0);
  });
  // Do not hang on open keep-alive connections.
  setTimeout(() => process.exit(0), 2_000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
