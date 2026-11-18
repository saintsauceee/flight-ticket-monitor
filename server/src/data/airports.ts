import type { Airport } from '@shared/types';
import raw from './airports.json';

type Row = [code: string, name: string, city: string, country: string, lat: number, lon: number, size: number];

// The busiest passenger airports. OurAirports has no traffic figures, so this
// list is what keeps "lon" resolving to Heathrow before London, Ontario.
const MAJOR = (
  'ATL DFW DEN ORD LAX JFK LAS MCO MIA CLT SEA PHX EWR SFO IAH BOS FLL MSP LGA DTW PHL SLC DCA SAN BWI TPA AUS IAD BNA MDW HNL DAL PDX STL ' +
  'YYZ YVR YUL YYC MEX CUN GDL BOG GRU GIG LIM SCL EZE PTY ' +
  'LHR LGW STN LTN MAN EDI DUB CDG ORY AMS FRA MUC BER DUS HAM MAD BCN PMI AGP LIS OPO FCO MXP VCE NAP ZRH GVA VIE BRU CPH ARN OSL HEL ' +
  'ATH IST SAW AYT WAW PRG BUD OTP KEF ' +
  'DXB AUH DOH RUH JED TLV CAI CMN JNB CPT ADD NBO LOS ' +
  'DEL BOM BLR MAA HYD CCU CMB DAC KTM ' +
  'SIN KUL BKK DMK HKT CGK DPS MNL CEB SGN HAN ' +
  'HKG TPE PEK PKX PVG SHA CAN SZX CTU XIY HGH ICN GMP PUS NRT HND KIX FUK CTS ' +
  'SYD MEL BNE PER ADL AKL CHC'
).split(/\s+/);
const MAJOR_INDEX = new Map(MAJOR.map((code, i) => [code, i]));

// Airports known by the city they serve rather than the municipality they sit
// in: shown under that city ("Tokyo (NRT)", not "Narita").
const SERVED_CITY: Record<string, string> = {
  NRT: 'Tokyo', LGW: 'London', STN: 'London', LTN: 'London', ORY: 'Paris', IAD: 'Washington', DCA: 'Washington',
  MXP: 'Milan', LIN: 'Milan', KIX: 'Osaka', ITM: 'Osaka', ICN: 'Seoul', GMP: 'Seoul', PVG: 'Shanghai', SHA: 'Shanghai',
  PEK: 'Beijing', PKX: 'Beijing', EZE: 'Buenos Aires', AEP: 'Buenos Aires', GRU: 'São Paulo', CGH: 'São Paulo',
  GIG: 'Rio de Janeiro', SDU: 'Rio de Janeiro', FCO: 'Rome', CIA: 'Rome', ARN: 'Stockholm', KUL: 'Kuala Lumpur',
  CGK: 'Jakarta', DMK: 'Bangkok', SAW: 'Istanbul', TSA: 'Taipei', TPE: 'Taipei', DWC: 'Dubai', DFW: 'Dallas',
  SGN: 'Ho Chi Minh City', DEL: 'Delhi', BOM: 'Mumbai',
};

// Extra names an airport should be found by, without changing how it is shown.
const SEARCH_ALIASES: Record<string, string> = {
  EWR: 'New York', BWI: 'Washington', MDW: 'Chicago', BGY: 'Milan', OAK: 'San Francisco', SJC: 'San Francisco',
  FLL: 'Miami', HOU: 'Houston', DAL: 'Dallas', BVA: 'Paris', CRL: 'Brussels', NYO: 'Stockholm', AVV: 'Melbourne',
  YTZ: 'Toronto', SGN: 'Saigon', BOM: 'Bombay', DEL: 'New Delhi', GRU: 'Sao Paulo', CGH: 'Sao Paulo',
};

interface IndexedAirport extends Airport {
  rank: number;
  haystack: string;
  /** Lower-cased city names this airport answers to. */
  cities: string[];
}

const countryNames = new Intl.DisplayNames(['en'], { type: 'region' });

export function countryName(code: string): string {
  try {
    return countryNames.of(code) ?? code;
  } catch {
    return code;
  }
}

const all: IndexedAirport[] = (raw as Row[]).map(([code, name, municipality, country, lat, lon, size]) => {
  // "Sydney (Mascot)" -> "Sydney"
  const local = municipality.replace(/\s*\(.*\)\s*$/, '');
  const city = SERVED_CITY[code] ?? (local || name);
  const names = [city, local, SEARCH_ALIASES[code]].filter((n): n is string => !!n);
  const major = MAJOR_INDEX.get(code);
  return {
    code,
    name,
    city,
    country,
    lat,
    lon,
    // Major airports first, in the order listed above; then by size.
    rank: size + (major == null ? 0 : 4 + (1 - major / MAJOR.length)),
    cities: [...new Set(names.map((n) => n.toLowerCase()))],
    haystack: `${names.join(' ')} ${name} ${countryName(country)}`.toLowerCase(),
  };
});

const byCode = new Map(all.map((a) => [a.code, a]));

function strip(a: IndexedAirport): Airport {
  return { code: a.code, name: a.name, city: a.city, country: a.country, lat: a.lat, lon: a.lon };
}

export function getAirport(code: string): Airport | null {
  const a = byCode.get(code.toUpperCase());
  return a ? strip(a) : null;
}

/** Looks up several codes at once; unknown codes are skipped. */
export function airportMap(codes: Iterable<string>): Record<string, Airport> {
  const out: Record<string, Airport> = {};
  for (const code of codes) {
    const a = getAirport(code);
    if (a) out[a.code] = a;
  }
  return out;
}

export function searchAirports(query: string, limit = 8): Airport[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return all
      .filter((a) => a.rank >= 6)
      .sort((a, b) => b.rank - a.rank)
      .slice(0, limit)
      .map(strip);
  }
  const scored: { a: IndexedAirport; score: number }[] = [];
  for (const a of all) {
    let score = 0;
    if (a.code.toLowerCase() === q) score = 100;
    else if (a.cities.includes(q)) score = 70;
    else if (a.cities.some((city) => city.startsWith(q))) score = 60;
    else if (q.length <= 3 && a.code.toLowerCase().startsWith(q)) score = 50;
    else if (a.haystack.split(/[\s/,-]+/).some((word) => word.startsWith(q))) score = 35;
    else if (q.length >= 4 && a.haystack.includes(q)) score = 20;
    if (score > 0) scored.push({ a, score: score + a.rank * 2 });
  }
  scored.sort((x, y) => y.score - x.score || x.a.code.localeCompare(y.a.code));
  return scored.slice(0, limit).map((s) => strip(s.a));
}

export function airportCount(): number {
  return all.length;
}
