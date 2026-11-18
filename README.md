# flight-ticket-monitor

A self-hosted flight price tracker. Search a trip, see what each airline really
costs once your bags are added, and track the price over time until it is the
right moment to book.

- **Find the cheapest dates.** Search with "Any dates" to get the lowest fare
  for every departure date in the next 1, 3 or 6 months, as a chart, per month,
  and as a list of the cheapest dates. Open any date to compare its flights.
- **Find the lowest price for a date.** Results are ranked by total cost with
  your bags, and the cheapest fare for each nearby departure date is shown.
- **Compare historical prices.** Tracked trips are re-checked on a schedule and
  every price is stored. The chart shows the lowest fare over time, the typical
  range, your target, and the same history per airline. A trip tracked with
  flexible dates is scanned across all its dates each time, and you are alerted
  when a cheap fare appears in any month.
- **Compare airlines.** One row per airline: fare, bag fees, stops and duration,
  legroom, Wi-Fi, power, entertainment, change rules and CO₂.

Out of the box it runs on **simulated demo data**, so you can try everything
without an account. Add a SerpApi key to switch to live Google Flights fares.

## Quick start

Requires Node.js 20.12 or newer.

```sh
npm install
npm run dev        # web app on http://localhost:5173, API on http://127.0.0.1:8787
```

For everyday use, build once and run the single server:

```sh
npm run build
npm start          # http://127.0.0.1:8787
```

Or let `run.sh` do it. It installs dependencies and rebuilds when something
changed, then starts the server and opens the browser:

```sh
./run.sh             # start now; Ctrl+C stops it
./run.sh install     # macOS: start at login and keep running in the background
./run.sh status      # is it running, is start-at-login on
./run.sh logs        # follow the background service's log
./run.sh uninstall   # stop the background service and remove it
```

`install` registers a per-user launchd agent
(`~/Library/LaunchAgents/com.flight-ticket-monitor.plist`) that restarts the
server if it crashes. Run it again after changing the code, `.env` or your Node
version. The background service and `npm run dev` both use port 8787, so
uninstall it before developing.

Tracking only happens while the server is running. When it has been off for a
while, the next check fills the gap from the provider's own price history where
that is available.

## Live fares

1. Create an API key at [serpapi.com](https://serpapi.com/google-flights-api)
   (the Google Flights API).
2. Copy `.env.example` to `.env` and set `SERPAPI_KEY`.
3. Restart the server. The Settings page shows the active source and usage.

SerpApi bills per search, so the app keeps a monthly budget
(`SERPAPI_MONTHLY_BUDGET`, default 250) and stops calling out when it is spent.
What costs a search:

| Action | Searches |
| --- | --- |
| A flight search, or a scheduled re-check of a tracked trip | 1 |
| An "Any dates" search or scan (every departure date, up to 6 months ahead) | 1 |
| Repeating the same search within the cache window (60 min) | 0 |
| Starting to track the trip you just searched | 0 |
| "Check nearby dates" | 1 per date not already cached |
| "Load fare details and bag fees" for one flight | 1 one-way, 2 round trip |

With live fares, tracked trips are checked every 24 hours by default, so one
trip uses about 30 searches a month. That holds for a trip with flexible dates
too. Settings shows the projected monthly total.

Things to know about the live source:

- The search itself only says whether a checked bag costs extra. Exact bag fees
  and fare rules come from "Load fare details" on a flight.
- For round trips Google lists outbound flights with the round-trip price; the
  matching return flight is filled in when you load fare details.
- Trips tracked in demo mode keep their simulated history. Delete them before
  switching to live fares.
- "Any dates" uses Google Flights' date calendar, which gives one lowest fare
  per departure date and nothing else: no airline, stops or bags. Those come
  from opening a date. The calendar's figure and the search's lowest fare for
  the same date are fetched separately and can differ slightly.
- The calendar only reaches about six months ahead, so that is the longest
  period "Any dates" offers. Checked against the live API in November 2026: a
  range ending 183 days out came back complete, while ranges ending 270 days
  out, or starting 184 days out, came back empty. Asking past the limit loses
  the whole answer, not just the far end, so the app asks for 180 days at most.
  Fares further out are only reachable by searching exact dates.

## How it works

**Tracking.** Each tracked trip stores a snapshot per check: the lowest fare,
the cheapest fare per airline, and the provider's price level. A new trip is
back-filled with the provider's price history so the chart is useful from day
one.

**Flexible dates.** A trip tracked with "Any dates" has no departure date. Each
check prices every departure date from tomorrow to the end of its period (for
round trips, with a fixed number of nights) and stores them all. The period
rolls forward a day at a time, so the trip never expires. Its history is the
cheapest fare for any date at each scan, and per departure month.

**Alerts** are raised when a check finds the price at or below your target (once
per crossing), at a new low, or down by at least `PRICE_DROP_ALERT_PCT` (default
5%) since the previous observation. For a trip with flexible dates the drop is
judged per departure month: when the cheapest fare of any month falls by that
much, the alert names the month and the dates, even if another month is still
cheaper overall. Months are compared only over dates both scans cover, so a date
entering the period does not count as a drop. Alerts appear in the app; there is
no email or push delivery yet.

**The buy/wait signal** on a tracked trip is a rule of thumb, not a forecast. It
weighs the provider's price level, where today's price sits among the prices
seen so far, the past week's direction, and how close departure is, and it lists
its reasons.

**Bag totals.** Set the bags you bring (per traveller) once. Totals add the fees
for bags the fare does not include. A fee is taken as per traveller for the whole
trip. Where a needed fee is unknown the total is marked as incomplete rather than
guessed.

**Demo data** comes from a deterministic simulator: plausible airlines per route,
fares that drift, jump and go on sale as time passes, and 60 days of history. It
is good for trying the app and useless for booking decisions; the app labels it
on every page.

## Configuration

All settings are optional environment variables, read from `.env` at the project
root. See [`.env.example`](.env.example) for the full list: provider key and
budget, check interval, alert threshold, cache time, port, host and database
path.

The app has no login. It listens on `127.0.0.1` only; put it behind your own
authentication before exposing it to a network.

Data lives in a single SQLite file, `data/flights.db`.

## Project layout

```
shared/    Types and bag-cost logic used by both sides
server/    API, scheduler, SQLite storage (Hono + better-sqlite3)
  src/providers/mock/      simulated fares
  src/providers/serpapi/   Google Flights via SerpApi
  src/services/            search + cache, flexible dates, tracking, alerts, insights, budget
web/       React app (Vite, Tailwind, TanStack Query, Recharts)
scripts/   build-airports.mjs regenerates the airport list
```

Adding another data source means implementing `FlightProvider`
(`server/src/providers/types.ts`) and registering it in
`server/src/providers/index.ts`.

## Development

```sh
npm test            # server tests (Vitest)
npm run typecheck   # server and web
npm run data:airports   # refresh server/src/data/airports.json from OurAirports
```

The SerpApi adapter is tested against the response shapes in SerpApi's
documentation, with the HTTP layer faked. The calendar request ("Any dates") has
also been checked against the live API by hand. The test suite itself never
calls the live API, so expect to adjust the baggage-text parsing in
`server/src/providers/serpapi/mapper.ts` if Google words a line in a way the
parser does not know.

Airport data is from [OurAirports](https://ourairports.com/data/) (public
domain).
