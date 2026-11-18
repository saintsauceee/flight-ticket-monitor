import { describe, expect, it } from 'vitest';
import {
  applyBookingDetails,
  combineBaggage,
  mapInsights,
  mapOffers,
  parseBaggageLines,
  type SerpResponse,
} from '../src/providers/serpapi/mapper';
import { SerpApiProvider } from '../src/providers/serpapi/provider';
import { query } from './helpers';

// Shaped after the sample responses in SerpApi's Google Flights documentation.
const searchResponse: SerpResponse = {
  search_metadata: { google_flights_url: 'https://www.google.com/travel/flights?hl=en&gl=us&curr=USD&tfs=abc' },
  best_flights: [
    {
      flights: [
        {
          departure_airport: { name: 'Paris Charles de Gaulle Airport', id: 'CDG', time: '2026-03-03 10:10' },
          arrival_airport: { name: 'Heathrow Airport', id: 'LHR', time: '2026-03-03 10:40' },
          duration: 90,
          airplane: 'Airbus A319',
          airline: 'British Airways',
          airline_logo: 'https://www.gstatic.com/flights/airline_logos/70px/BA.png',
          flight_number: 'BA 301',
          legroom: '29 in',
          extensions: ['Below average legroom (29 in)', 'Wi-Fi for a fee', 'In-seat USB outlet', 'Carbon emissions estimate: 42 kg'],
        },
        {
          departure_airport: { name: 'Heathrow Airport', id: 'LHR', time: '2026-03-03 12:10' },
          arrival_airport: { name: 'Austin-Bergstrom International Airport', id: 'AUS', time: '2026-03-03 16:50' },
          duration: 640,
          airplane: 'Boeing 787',
          airline: 'American',
          airline_logo: 'https://www.gstatic.com/flights/airline_logos/70px/AA.png',
          flight_number: 'AA 7001',
          legroom: '31 in',
          extensions: ['Average legroom (31 in)', 'Free Wi-Fi', 'In-seat power & USB outlets', 'On-demand video'],
          often_delayed_by_over_30_min: true,
          plane_and_crew_by: 'British Airways',
        },
      ],
      layovers: [{ duration: 90, name: 'Heathrow Airport', id: 'LHR' }],
      total_duration: 820,
      carbon_emissions: { this_flight: 525000, typical_for_this_route: 529000, difference_percent: -1 },
      price: 520,
      type: 'One way',
      extensions: ['Checked baggage for a fee'],
      booking_token: 'BOOK-1',
    },
  ],
  other_flights: [
    {
      flights: [
        {
          departure_airport: { id: 'CDG', time: '2026-03-03 20:35' },
          arrival_airport: { id: 'AUS', time: '2026-03-04 01:10' },
          duration: 695,
          airline: 'Air France',
          flight_number: 'AF 640',
          legroom: '81 cm',
          extensions: ['Above average legroom (32 in)'],
        },
      ],
      total_duration: 695,
      price: 498,
      booking_token: 'BOOK-2',
    },
    // Rows without a price cannot be compared and are dropped.
    { flights: [{ departure_airport: { id: 'CDG', time: '2026-03-03 07:00' }, arrival_airport: { id: 'AUS', time: '2026-03-03 12:00' }, flight_number: 'DL 99' }] },
  ],
  price_insights: {
    lowest_price: 498,
    price_level: 'low',
    typical_price_range: [570, 1050],
    price_history: [
      [1691100000, 575],
      [1691013600, 590],
      [1696197600, 498],
    ],
  },
};

const oneWay = { ...query, origin: 'CDG', destination: 'AUS', departDate: '2026-03-03', returnDate: null };

describe('SerpApi mapping', () => {
  it('maps itineraries onto offers, cheapest first', () => {
    const offers = mapOffers(searchResponse, oneWay);
    expect(offers.map((o) => o.price)).toEqual([498, 520]);

    const ba = offers[1]!;
    expect(ba.airline).toMatchObject({ code: 'BA', name: 'British Airways' });
    expect(ba.airlines.map((a) => a.code)).toEqual(['BA', 'AA']);
    expect(ba.stops).toBe(1);
    expect(ba.durationMin).toBe(820);
    expect(ba.slices[0]?.segments[0]).toMatchObject({ flightNumber: 'BA 301', from: 'CDG', to: 'LHR', departAt: '2026-03-03T10:10', arriveAt: '2026-03-03T10:40' });
    expect(ba.slices[0]?.segments[1]?.operatedBy).toBe('British Airways');
    expect(ba.slices[0]?.layovers).toEqual([{ airport: 'LHR', durationMin: 90, overnight: false }]);
    expect(ba.emissionsKg).toBe(525);
    expect(ba.emissionsDiffPct).toBe(-1);
    expect(ba.oftenDelayed).toBe(true);
    // Amenities describe the longest segment, where they matter most.
    expect(ba.amenities).toMatchObject({ legroomIn: 31, legroomRating: 'average', wifi: 'free', power: true, entertainment: true });
    expect(ba.baggage.checked).toMatchObject({ status: 'fee', fee: null });
    expect(ba.baggage.carryOn.status).toBe('unknown');
    expect(ba.details).toBe('available');
    expect(ba.detailsCost).toBe(1);
    expect(ba.ref).toEqual({ bookingToken: 'BOOK-1' });

    expect(offers[0]?.amenities).toMatchObject({ legroomIn: 32, legroomRating: 'above', wifi: null });
  });

  it('needs two searches for round-trip details and keys them off the departure token', () => {
    const res: SerpResponse = { other_flights: [{ ...searchResponse.other_flights![0]!, booking_token: undefined, departure_token: 'DEP-1' }] };
    const [o] = mapOffers(res, { ...oneWay, returnDate: '2026-03-10' });
    expect(o).toMatchObject({ details: 'available', detailsCost: 2, ref: { departureToken: 'DEP-1' } });
  });

  it('maps price insights with history oldest first', () => {
    const { insights, history } = mapInsights(searchResponse);
    expect(insights).toEqual({ lowestPrice: 498, level: 'low', typicalRange: [570, 1050] });
    expect(history.map((h) => h.price)).toEqual([590, 575, 498]);
    expect(history[0]?.t).toBe(new Date(1691013600 * 1000).toISOString());
    expect(mapInsights({})).toEqual({ insights: null, history: [] });
  });

  it('reads baggage lines', () => {
    expect(parseBaggageLines(['1 free carry-on', '1st checked bag: 99-187'])).toEqual({
      carryOn: { status: 'included', quantity: 1, fee: null, feeMax: null, note: null },
      checked: { status: 'fee', quantity: 0, fee: 99, feeMax: 187, note: null },
    });
    expect(parseBaggageLines(['1st checked bag up to 23 kg free']).checked).toMatchObject({ status: 'included', quantity: 1, note: 'up to 23 kg' });
    expect(parseBaggageLines(['2 free checked bags']).checked).toMatchObject({ status: 'included', quantity: 2 });
    expect(parseBaggageLines(['Carry-on bag: $1,035']).carryOn).toMatchObject({ status: 'fee', fee: 1035 });
    expect(parseBaggageLines(['Checked baggage for a fee', 'No refunds'])).toMatchObject({
      carryOn: { status: 'unknown' },
      checked: { status: 'fee', fee: null },
    });
  });

  it('adds up bag fees of separately ticketed directions', () => {
    const each = parseBaggageLines(['1 free carry-on', '1st checked bag: 30']);
    const both = combineBaggage(each, each);
    expect(both.carryOn).toMatchObject({ status: 'included', quantity: 1 });
    expect(both.checked).toMatchObject({ status: 'fee', fee: 60 });

    const oneFree = combineBaggage(each, parseBaggageLines(['1 free carry-on', '1 free checked bag']));
    expect(oneFree.checked).toMatchObject({ status: 'fee', fee: 30, note: 'one direction only' });
    expect(combineBaggage(each, parseBaggageLines([])).checked).toMatchObject({ status: 'fee', fee: null });
  });

  it('applies booking options to an offer', () => {
    const [, ba] = mapOffers(searchResponse, oneWay);
    const detailed = applyBookingDetails(ba!, {
      selected_flights: [searchResponse.best_flights![0]!],
      baggage_prices: { together: ['1 free carry-on', '1st checked bag: 99-187'] },
      booking_options: [
        { together: { book_with: 'Gotogate', price: 540, baggage_prices: ['1 free carry-on'] } },
        {
          together: {
            book_with: 'British Airways',
            airline: true,
            price: 520,
            option_title: 'Basic Economy',
            extensions: ['No refunds', 'Ticket changes for a fee', 'Seat selection for a fee', 'Standard seat'],
            baggage_prices: ['1 free carry-on', '1st checked bag: 99'],
          },
        },
      ],
    });
    expect(detailed.details).toBe('full');
    expect(detailed.fare).toEqual({ brand: 'Basic Economy', changes: 'fee', refund: 'no', seatSelection: 'fee' });
    expect(detailed.baggage).toMatchObject({
      source: 'fare_details',
      carryOn: { status: 'included', quantity: 1 },
      checked: { status: 'fee', fee: 99 },
    });
    expect(detailed.slices).toHaveLength(1);
  });
});

function fakeFetch(responses: { status?: number; body: unknown }[]) {
  const urls: URL[] = [];
  const impl = (async (input: Parameters<typeof fetch>[0]) => {
    urls.push(new URL(String(input)));
    const next = responses.shift();
    if (!next) throw new Error('unexpected request');
    return new Response(JSON.stringify(next.body), { status: next.status ?? 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { impl, urls };
}

describe('SerpApi provider', () => {
  const make = (responses: { status?: number; body: unknown }[]) => {
    const { impl, urls } = fakeFetch(responses);
    return { provider: new SerpApiProvider({ apiKey: 'secret-key', gl: 'us', deepSearch: false, fetch: impl }), urls };
  };

  it('sends the documented parameters', async () => {
    const { provider, urls } = make([{ body: searchResponse }]);
    const result = await provider.search({ ...oneWay, adults: 2, cabin: 'business', currency: 'EUR', maxStops: 0 });
    const p = urls[0]!.searchParams;
    expect(urls[0]!.origin + urls[0]!.pathname).toBe('https://serpapi.com/search.json');
    expect(Object.fromEntries(p)).toMatchObject({
      engine: 'google_flights', departure_id: 'CDG', arrival_id: 'AUS', outbound_date: '2026-03-03',
      type: '2', travel_class: '3', adults: '2', currency: 'EUR', stops: '1', api_key: 'secret-key',
    });
    expect(p.has('return_date')).toBe(false);
    expect(result.cost).toBe(1);
    expect(result.offers).toHaveLength(2);
    expect(result.externalUrl).toContain('google.com/travel/flights');
  });

  it('asks for a round trip when there is a return date', async () => {
    const { provider, urls } = make([{ body: searchResponse }]);
    await provider.search({ ...oneWay, returnDate: '2026-03-10' });
    expect(Object.fromEntries(urls[0]!.searchParams)).toMatchObject({ type: '1', return_date: '2026-03-10' });
    expect(urls[0]!.searchParams.has('stops')).toBe(false);
  });

  it('treats "no results" as an empty search rather than a failure', async () => {
    const { provider } = make([{ body: { error: "Google Flights hasn't returned any results for this query." } }]);
    const result = await provider.search(oneWay);
    expect(result.offers).toEqual([]);
    expect(result.insights).toBeNull();
  });

  it('reports a rejected key without leaking it', async () => {
    const { provider } = make([{ status: 401, body: { error: 'Invalid API key. Your API key should be here: https://serpapi.com/manage-api-key' } }]);
    const err = await provider.search(oneWay).catch((e: Error) => e);
    expect(err).toMatchObject({ code: 'provider_auth' });
    expect((err as Error).message).not.toContain('secret-key');
  });

  it('hides the key when the network fails', async () => {
    const provider = new SerpApiProvider({
      apiKey: 'secret-key', gl: 'us', deepSearch: false,
      fetch: (async (input: Parameters<typeof fetch>[0]) => {
        throw new Error(`connect ECONNREFUSED ${String(input)}`);
      }) as typeof fetch,
    });
    const err = (await provider.search(oneWay).catch((e: Error) => e)) as Error;
    expect(err.message).toBe('SerpApi could not be reached');
  });

  it('loads one-way details with a single booking request', async () => {
    const { provider, urls } = make([{ body: { baggage_prices: { together: ['1 free carry-on', '1st checked bag: 75'] }, booking_options: [] } }]);
    const [, ba] = mapOffers(searchResponse, oneWay);
    const { offer, cost } = await provider.loadDetails(oneWay, ba!);
    expect(cost).toBe(1);
    expect(urls[0]!.searchParams.get('booking_token')).toBe('BOOK-1');
    expect(offer.baggage.checked).toMatchObject({ status: 'fee', fee: 75 });
  });

  it('picks the cheapest return before loading round-trip details', async () => {
    const roundTrip = { ...oneWay, returnDate: '2026-03-10' };
    const outbound = mapOffers({ other_flights: [{ ...searchResponse.other_flights![0]!, booking_token: undefined, departure_token: 'DEP-1' }] }, roundTrip)[0]!;
    const returnLeg = {
      flights: [{ departure_airport: { id: 'AUS', time: '2026-03-10 18:00' }, arrival_airport: { id: 'CDG', time: '2026-03-11 11:00' }, duration: 600, airline: 'Air France', flight_number: 'AF 641' }],
      total_duration: 600,
    };
    const { provider, urls } = make([
      { body: { other_flights: [{ ...returnLeg, price: 900, booking_token: 'BOOK-DEAR' }, { ...returnLeg, price: 498, booking_token: 'BOOK-CHEAP' }] } },
      {
        body: {
          selected_flights: [searchResponse.other_flights![0], returnLeg],
          baggage_prices: { departing: ['1 free carry-on', '1st checked bag: 30'], returning: ['1 free carry-on', '1st checked bag: 30'] },
        },
      },
    ]);
    const { offer, cost } = await provider.loadDetails(roundTrip, outbound);
    expect(cost).toBe(2);
    expect(urls[0]!.searchParams.get('departure_token')).toBe('DEP-1');
    expect(urls[1]!.searchParams.get('booking_token')).toBe('BOOK-CHEAP');
    expect(offer.slices).toHaveLength(2);
    expect(offer.slices[1]?.segments[0]).toMatchObject({ from: 'AUS', to: 'CDG' });
    expect(offer.baggage.checked).toMatchObject({ status: 'fee', fee: 60 });
  });
});
