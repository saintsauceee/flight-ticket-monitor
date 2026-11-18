// Airline profiles for the simulated provider. Everything here (prices, bag
// fees, amenities) is illustrative: close enough to reality to exercise the
// app, but not a source of truth about any airline's actual policies.

export type BagPolicy = 'inc' | number;

export interface MockAirline {
  code: string;
  name: string;
  kind: 'legacy' | 'premium' | 'lcc';
  /** Home markets (ISO-2). For low-cost carriers: every country they fly to. */
  countries: string[];
  /** Low-cost carriers only fly routes touching one of these countries. Defaults to `countries`. */
  bases?: string[];
  /** Connecting hubs. Low-cost carriers fly point to point and have none. */
  hubs: string[];
  /** Carries lots of connecting traffic between continents through its hub. */
  connector?: boolean;
  /** Longest nonstop leg the airline operates, km. Defaults depend on the kind of carrier. */
  maxKm?: number;
  /** Only flies intercontinental routes (no short-haul network of its own). */
  longHaulOnly?: boolean;
  priceIndex: number;
  legroom: number;
  wifi: 'free' | 'paid' | 'none';
  power: boolean;
  ife: boolean;
  /** One-way USD fees on the cheapest economy fare, or "inc" when included. */
  carryOn: BagPolicy;
  checkedShort: BagPolicy;
  checkedLong: BagPolicy;
  /** Checked bags included when the policy is "inc". */
  includedBags?: number;
  /** Name of the cheapest economy fare. */
  brand: string;
  changes: 'free' | 'fee' | 'no';
  refund: 'fee' | 'no';
}

type Seed = Omit<MockAirline, 'kind' | 'hubs' | 'countries'>;

const legacy = (countries: string, hubs: string, a: Seed): MockAirline => ({
  kind: 'legacy',
  countries: countries.split(' '),
  hubs: hubs.split(' '),
  ...a,
});
const premium = (countries: string, hubs: string, a: Seed): MockAirline => ({ ...legacy(countries, hubs, a), kind: 'premium' });
const lcc = (countries: string, a: Seed & { bases?: string[] }): MockAirline => ({
  kind: 'lcc',
  countries: countries.split(' '),
  hubs: [],
  ...a,
});

const EU_LCC = 'IE GB ES IT DE FR PT PL BE NL GR HU AT DK SE NO CZ MA HR MT CY RO BG LV LT EE SK FI CH';

export const AIRLINES: MockAirline[] = [
  // --- North America ---
  legacy('US', 'DFW CLT ORD MIA PHL PHX JFK LAX DCA', {
    code: 'AA', name: 'American', priceIndex: 1.0, legroom: 30, wifi: 'paid', power: true, ife: true,
    carryOn: 'inc', checkedShort: 40, checkedLong: 75, brand: 'Basic Economy', changes: 'no', refund: 'no',
  }),
  legacy('US', 'ATL DTW MSP SLC JFK LAX SEA BOS LGA', {
    code: 'DL', name: 'Delta', priceIndex: 1.06, legroom: 31, wifi: 'free', power: true, ife: true,
    carryOn: 'inc', checkedShort: 35, checkedLong: 75, brand: 'Main Basic', changes: 'no', refund: 'no',
  }),
  legacy('US', 'ORD DEN IAH EWR SFO IAD LAX', {
    code: 'UA', name: 'United', priceIndex: 1.02, legroom: 30, wifi: 'paid', power: true, ife: true,
    carryOn: 'inc', checkedShort: 40, checkedLong: 75, brand: 'Basic Economy', changes: 'no', refund: 'no',
  }),
  legacy('US', 'JFK BOS FLL', {
    code: 'B6', maxKm: 6500, name: 'JetBlue', priceIndex: 0.9, legroom: 32, wifi: 'free', power: true, ife: true,
    carryOn: 'inc', checkedShort: 40, checkedLong: 65, brand: 'Blue Basic', changes: 'fee', refund: 'no',
  }),
  legacy('US', 'SEA PDX SFO LAX ANC', {
    code: 'AS', maxKm: 6500, name: 'Alaska', priceIndex: 0.95, legroom: 31, wifi: 'paid', power: true, ife: true,
    carryOn: 'inc', checkedShort: 40, checkedLong: 40, brand: 'Saver', changes: 'no', refund: 'no',
  }),
  lcc('US MX DO JM CR PR', {
    code: 'WN', name: 'Southwest', bases: ['US'], maxKm: 4300, priceIndex: 0.86, legroom: 32, wifi: 'paid', power: true, ife: true,
    carryOn: 'inc', checkedShort: 35, checkedLong: 35, brand: 'Basic', changes: 'no', refund: 'no',
  }),
  lcc('US MX CO DO JM CR PR PE', {
    code: 'NK', name: 'Spirit', bases: ['US'], maxKm: 4300, priceIndex: 0.6, legroom: 28, wifi: 'paid', power: false, ife: false,
    carryOn: 45, checkedShort: 50, checkedLong: 50, brand: 'Value', changes: 'fee', refund: 'no',
  }),
  lcc('US MX DO JM CR PR', {
    code: 'F9', name: 'Frontier', bases: ['US'], maxKm: 4300, priceIndex: 0.58, legroom: 28, wifi: 'none', power: false, ife: false,
    carryOn: 50, checkedShort: 55, checkedLong: 55, brand: 'Basic', changes: 'fee', refund: 'no',
  }),
  legacy('CA', 'YYZ YUL YVR YYC', {
    code: 'AC', name: 'Air Canada', priceIndex: 1.02, legroom: 30, wifi: 'paid', power: true, ife: true,
    carryOn: 'inc', checkedShort: 35, checkedLong: 75, brand: 'Economy Basic', changes: 'no', refund: 'no',
  }),
  legacy('CA', 'YYC YYZ YVR', {
    code: 'WS', maxKm: 8500, name: 'WestJet', priceIndex: 0.9, legroom: 31, wifi: 'paid', power: true, ife: true,
    carryOn: 'inc', checkedShort: 35, checkedLong: 70, brand: 'UltraBasic', changes: 'no', refund: 'no',
  }),
  legacy('MX', 'MEX', {
    code: 'AM', name: 'Aeromexico', priceIndex: 0.95, legroom: 31, wifi: 'paid', power: true, ife: true,
    carryOn: 'inc', checkedShort: 40, checkedLong: 70, brand: 'Basic', changes: 'no', refund: 'no',
  }),
  lcc('MX US GT CR SV CO', {
    code: 'Y4', name: 'Volaris', bases: ['MX'], maxKm: 4500, priceIndex: 0.55, legroom: 28, wifi: 'none', power: false, ife: false,
    carryOn: 30, checkedShort: 45, checkedLong: 45, brand: 'Zero', changes: 'fee', refund: 'no',
  }),

  // --- Europe ---
  legacy('GB', 'LHR LGW', {
    code: 'BA', name: 'British Airways', priceIndex: 1.05, legroom: 30, wifi: 'paid', power: true, ife: true,
    carryOn: 'inc', checkedShort: 45, checkedLong: 80, brand: 'Economy Basic', changes: 'fee', refund: 'no',
  }),
  legacy('GB', 'LHR MAN', {
    code: 'VS', longHaulOnly: true, name: 'Virgin Atlantic', priceIndex: 1.04, legroom: 31, wifi: 'paid', power: true, ife: true,
    carryOn: 'inc', checkedShort: 45, checkedLong: 80, brand: 'Economy Light', changes: 'fee', refund: 'no',
  }),
  legacy('DE', 'FRA MUC', {
    code: 'LH', name: 'Lufthansa', priceIndex: 1.06, legroom: 30, wifi: 'paid', power: true, ife: true,
    carryOn: 'inc', checkedShort: 40, checkedLong: 75, brand: 'Economy Light', changes: 'fee', refund: 'no',
  }),
  legacy('FR', 'CDG', {
    code: 'AF', name: 'Air France', priceIndex: 1.03, legroom: 31, wifi: 'paid', power: true, ife: true,
    carryOn: 'inc', checkedShort: 40, checkedLong: 75, brand: 'Light', changes: 'fee', refund: 'no',
  }),
  legacy('NL', 'AMS', {
    code: 'KL', name: 'KLM', priceIndex: 1.02, legroom: 30, wifi: 'paid', power: true, ife: true,
    carryOn: 'inc', checkedShort: 40, checkedLong: 75, brand: 'Light', changes: 'fee', refund: 'no',
  }),
  legacy('ES', 'MAD', {
    code: 'IB', name: 'Iberia', priceIndex: 0.95, legroom: 30, wifi: 'paid', power: true, ife: true,
    carryOn: 'inc', checkedShort: 40, checkedLong: 70, brand: 'Basic', changes: 'no', refund: 'no',
  }),
  legacy('IT', 'FCO', {
    code: 'AZ', name: 'ITA Airways', priceIndex: 0.94, legroom: 30, wifi: 'paid', power: true, ife: true,
    carryOn: 'inc', checkedShort: 40, checkedLong: 70, brand: 'Economy Light', changes: 'no', refund: 'no',
  }),
  legacy('CH', 'ZRH', {
    code: 'LX', name: 'SWISS', priceIndex: 1.12, legroom: 30, wifi: 'paid', power: true, ife: true,
    carryOn: 'inc', checkedShort: 45, checkedLong: 75, brand: 'Economy Light', changes: 'fee', refund: 'no',
  }),
  legacy('DK SE NO', 'CPH ARN OSL', {
    code: 'SK', name: 'SAS', priceIndex: 0.98, legroom: 30, wifi: 'paid', power: true, ife: true,
    carryOn: 'inc', checkedShort: 40, checkedLong: 70, brand: 'Go Light', changes: 'no', refund: 'no',
  }),
  legacy('PT', 'LIS', {
    code: 'TP', maxKm: 10000, name: 'TAP Air Portugal', priceIndex: 0.88, legroom: 30, wifi: 'paid', power: true, ife: true,
    carryOn: 'inc', checkedShort: 40, checkedLong: 70, brand: 'Discount', changes: 'no', refund: 'no',
  }),
  legacy('IE', 'DUB', {
    code: 'EI', maxKm: 9000, name: 'Aer Lingus', priceIndex: 0.9, legroom: 31, wifi: 'paid', power: true, ife: true,
    carryOn: 'inc', checkedShort: 40, checkedLong: 70, brand: 'Saver', changes: 'no', refund: 'no',
  }),
  legacy('FI', 'HEL', {
    code: 'AY', name: 'Finnair', priceIndex: 0.97, legroom: 31, wifi: 'paid', power: true, ife: true,
    carryOn: 'inc', checkedShort: 40, checkedLong: 70, brand: 'Superlight', changes: 'no', refund: 'no',
  }),
  {
    ...legacy('TR', 'IST', {
      code: 'TK', name: 'Turkish Airlines', priceIndex: 0.9, legroom: 31, wifi: 'paid', power: true, ife: true,
      carryOn: 'inc', checkedShort: 'inc', checkedLong: 'inc', includedBags: 1, brand: 'EcoFly', changes: 'fee', refund: 'fee',
    }),
    connector: true,
  },
  lcc(EU_LCC, {
    code: 'FR', name: 'Ryanair', maxKm: 4200, priceIndex: 0.5, legroom: 30, wifi: 'none', power: false, ife: false,
    carryOn: 30, checkedShort: 40, checkedLong: 40, brand: 'Basic', changes: 'fee', refund: 'no',
  }),
  lcc('GB FR IT CH DE ES PT NL GR HR AT CZ DK HU IS MA EG TR', {
    code: 'U2', name: 'easyJet', maxKm: 4200, priceIndex: 0.58, legroom: 29, wifi: 'none', power: false, ife: false,
    carryOn: 28, checkedShort: 38, checkedLong: 38, brand: 'Standard', changes: 'fee', refund: 'no',
  }),
  lcc('HU PL RO BG GB IT AT AL RS MK GE AE CY ES DE FR NL SE NO', {
    code: 'W6', name: 'Wizz Air', maxKm: 5200, priceIndex: 0.48, legroom: 28, wifi: 'none', power: false, ife: false,
    carryOn: 30, checkedShort: 45, checkedLong: 45, brand: 'Basic', changes: 'fee', refund: 'no',
  }),
  lcc('ES FR IT GB PT NL DE BE CH GR', {
    code: 'VY', name: 'Vueling', bases: ['ES', 'FR', 'IT'], maxKm: 3800, priceIndex: 0.6, legroom: 29, wifi: 'paid', power: false, ife: false,
    carryOn: 25, checkedShort: 40, checkedLong: 40, brand: 'Basic', changes: 'fee', refund: 'no',
  }),

  // --- Middle East & Africa ---
  {
    ...premium('AE', 'DXB', {
      code: 'EK', name: 'Emirates', priceIndex: 1.08, legroom: 32, wifi: 'paid', power: true, ife: true,
      carryOn: 'inc', checkedShort: 'inc', checkedLong: 'inc', includedBags: 1, brand: 'Saver', changes: 'fee', refund: 'fee',
    }),
    connector: true,
  },
  {
    ...premium('QA', 'DOH', {
      code: 'QR', name: 'Qatar Airways', priceIndex: 1.05, legroom: 32, wifi: 'free', power: true, ife: true,
      carryOn: 'inc', checkedShort: 'inc', checkedLong: 'inc', includedBags: 1, brand: 'Economy Classic', changes: 'fee', refund: 'fee',
    }),
    connector: true,
  },
  {
    ...legacy('AE', 'AUH', {
      code: 'EY', name: 'Etihad', priceIndex: 0.97, legroom: 31, wifi: 'paid', power: true, ife: true,
      carryOn: 'inc', checkedShort: 'inc', checkedLong: 'inc', includedBags: 1, brand: 'Economy Value', changes: 'fee', refund: 'fee',
    }),
    connector: true,
  },
  {
    ...legacy('ET', 'ADD', {
      code: 'ET', name: 'Ethiopian', priceIndex: 0.85, legroom: 31, wifi: 'none', power: true, ife: true,
      carryOn: 'inc', checkedShort: 'inc', checkedLong: 'inc', includedBags: 2, brand: 'Economy Saver', changes: 'fee', refund: 'fee',
    }),
    connector: true,
  },
  legacy('EG', 'CAI', {
    code: 'MS', name: 'EgyptAir', priceIndex: 0.82, legroom: 31, wifi: 'none', power: false, ife: true,
    carryOn: 'inc', checkedShort: 'inc', checkedLong: 'inc', includedBags: 1, brand: 'Economy', changes: 'fee', refund: 'fee',
  }),
  legacy('MA', 'CMN', {
    code: 'AT', maxKm: 9000, name: 'Royal Air Maroc', priceIndex: 0.82, legroom: 30, wifi: 'none', power: false, ife: true,
    carryOn: 'inc', checkedShort: 'inc', checkedLong: 'inc', includedBags: 1, brand: 'Economy', changes: 'fee', refund: 'fee',
  }),
  legacy('KE', 'NBO', {
    code: 'KQ', name: 'Kenya Airways', priceIndex: 0.88, legroom: 31, wifi: 'none', power: true, ife: true,
    carryOn: 'inc', checkedShort: 'inc', checkedLong: 'inc', includedBags: 1, brand: 'Economy', changes: 'fee', refund: 'fee',
  }),
  legacy('ZA', 'JNB', {
    code: 'SA', name: 'South African Airways', priceIndex: 0.9, legroom: 31, wifi: 'none', power: true, ife: true,
    carryOn: 'inc', checkedShort: 'inc', checkedLong: 'inc', includedBags: 1, brand: 'Economy', changes: 'fee', refund: 'fee',
  }),
  lcc('ZA', {
    code: 'FA', name: 'FlySafair', maxKm: 2500, priceIndex: 0.55, legroom: 29, wifi: 'none', power: false, ife: false,
    carryOn: 'inc', checkedShort: 20, checkedLong: 20, brand: 'Lite', changes: 'fee', refund: 'no',
  }),

  // --- Asia ---
  {
    ...premium('SG', 'SIN', {
      code: 'SQ', name: 'Singapore Airlines', priceIndex: 1.15, legroom: 32, wifi: 'free', power: true, ife: true,
      carryOn: 'inc', checkedShort: 'inc', checkedLong: 'inc', includedBags: 1, brand: 'Economy Lite', changes: 'fee', refund: 'fee',
    }),
    connector: true,
  },
  {
    ...premium('HK', 'HKG', {
      code: 'CX', name: 'Cathay Pacific', priceIndex: 1.08, legroom: 32, wifi: 'paid', power: true, ife: true,
      carryOn: 'inc', checkedShort: 'inc', checkedLong: 'inc', includedBags: 1, brand: 'Economy Light', changes: 'fee', refund: 'no',
    }),
    connector: true,
  },
  premium('JP', 'HND NRT', {
    code: 'NH', name: 'ANA', priceIndex: 1.1, legroom: 34, wifi: 'paid', power: true, ife: true,
    carryOn: 'inc', checkedShort: 'inc', checkedLong: 'inc', includedBags: 2, brand: 'Economy', changes: 'fee', refund: 'fee',
  }),
  premium('JP', 'HND NRT', {
    code: 'JL', name: 'Japan Airlines', priceIndex: 1.1, legroom: 34, wifi: 'free', power: true, ife: true,
    carryOn: 'inc', checkedShort: 'inc', checkedLong: 'inc', includedBags: 2, brand: 'Economy', changes: 'fee', refund: 'fee',
  }),
  legacy('KR', 'ICN', {
    code: 'KE', name: 'Korean Air', priceIndex: 1.02, legroom: 33, wifi: 'paid', power: true, ife: true,
    carryOn: 'inc', checkedShort: 'inc', checkedLong: 'inc', includedBags: 1, brand: 'Economy', changes: 'fee', refund: 'fee',
  }),
  legacy('TH', 'BKK', {
    code: 'TG', name: 'Thai Airways', priceIndex: 0.95, legroom: 32, wifi: 'paid', power: true, ife: true,
    carryOn: 'inc', checkedShort: 'inc', checkedLong: 'inc', includedBags: 1, brand: 'Economy Saver', changes: 'fee', refund: 'fee',
  }),
  legacy('MY', 'KUL', {
    code: 'MH', name: 'Malaysia Airlines', priceIndex: 0.88, legroom: 32, wifi: 'free', power: true, ife: true,
    carryOn: 'inc', checkedShort: 'inc', checkedLong: 'inc', includedBags: 1, brand: 'Economy Lite', changes: 'fee', refund: 'no',
  }),
  legacy('CN', 'PEK', {
    code: 'CA', name: 'Air China', priceIndex: 0.82, legroom: 31, wifi: 'none', power: true, ife: true,
    carryOn: 'inc', checkedShort: 'inc', checkedLong: 'inc', includedBags: 1, brand: 'Economy', changes: 'fee', refund: 'fee',
  }),
  legacy('CN', 'PVG', {
    code: 'MU', name: 'China Eastern', priceIndex: 0.8, legroom: 31, wifi: 'paid', power: true, ife: true,
    carryOn: 'inc', checkedShort: 'inc', checkedLong: 'inc', includedBags: 1, brand: 'Economy', changes: 'fee', refund: 'fee',
  }),
  legacy('CN', 'CAN', {
    code: 'CZ', name: 'China Southern', priceIndex: 0.8, legroom: 31, wifi: 'none', power: true, ife: true,
    carryOn: 'inc', checkedShort: 'inc', checkedLong: 'inc', includedBags: 1, brand: 'Economy', changes: 'fee', refund: 'fee',
  }),
  legacy('TW', 'TPE', {
    code: 'BR', name: 'EVA Air', priceIndex: 1.0, legroom: 32, wifi: 'paid', power: true, ife: true,
    carryOn: 'inc', checkedShort: 'inc', checkedLong: 'inc', includedBags: 1, brand: 'Economy Basic', changes: 'fee', refund: 'fee',
  }),
  legacy('TW', 'TPE', {
    code: 'CI', name: 'China Airlines', priceIndex: 0.93, legroom: 32, wifi: 'paid', power: true, ife: true,
    carryOn: 'inc', checkedShort: 'inc', checkedLong: 'inc', includedBags: 1, brand: 'Economy Basic', changes: 'fee', refund: 'fee',
  }),
  legacy('IN', 'DEL BOM', {
    code: 'AI', name: 'Air India', priceIndex: 0.85, legroom: 31, wifi: 'paid', power: true, ife: true,
    carryOn: 'inc', checkedShort: 'inc', checkedLong: 'inc', includedBags: 1, brand: 'Economy Value', changes: 'fee', refund: 'fee',
  }),
  legacy('VN', 'SGN HAN', {
    code: 'VN', name: 'Vietnam Airlines', priceIndex: 0.85, legroom: 31, wifi: 'none', power: true, ife: true,
    carryOn: 'inc', checkedShort: 'inc', checkedLong: 'inc', includedBags: 1, brand: 'Economy Lite', changes: 'fee', refund: 'no',
  }),
  legacy('ID', 'CGK', {
    code: 'GA', name: 'Garuda Indonesia', priceIndex: 0.9, legroom: 32, wifi: 'paid', power: true, ife: true,
    carryOn: 'inc', checkedShort: 'inc', checkedLong: 'inc', includedBags: 1, brand: 'Economy', changes: 'fee', refund: 'fee',
  }),
  legacy('PH', 'MNL', {
    code: 'PR', name: 'Philippine Airlines', priceIndex: 0.88, legroom: 31, wifi: 'paid', power: true, ife: true,
    carryOn: 'inc', checkedShort: 'inc', checkedLong: 'inc', includedBags: 1, brand: 'Economy Supersaver', changes: 'fee', refund: 'no',
  }),
  lcc('IN AE SG TH NP LK BD MY QA SA', {
    code: '6E', name: 'IndiGo', bases: ['IN'], maxKm: 5500, priceIndex: 0.55, legroom: 30, wifi: 'none', power: false, ife: false,
    carryOn: 'inc', checkedShort: 'inc', checkedLong: 'inc', includedBags: 1, brand: 'Saver', changes: 'fee', refund: 'fee',
  }),
  lcc('SG MY TH ID VN PH JP KR CN TW HK AU IN GR DE', {
    code: 'TR', name: 'Scoot', bases: ['SG'], maxKm: 10500, priceIndex: 0.55, legroom: 31, wifi: 'paid', power: true, ife: false,
    carryOn: 'inc', checkedShort: 35, checkedLong: 60, brand: 'Fly', changes: 'fee', refund: 'no',
  }),
  lcc('MY TH ID PH SG VN KH CN HK TW JP KR IN AU', {
    code: 'AK', name: 'AirAsia', bases: ['MY', 'TH', 'ID', 'PH'], maxKm: 7500, priceIndex: 0.5, legroom: 29, wifi: 'paid', power: false, ife: false,
    carryOn: 'inc', checkedShort: 30, checkedLong: 55, brand: 'Value', changes: 'fee', refund: 'no',
  }),
  lcc('PH SG HK JP KR TW TH VN MY ID AU AE CN', {
    code: '5J', name: 'Cebu Pacific', bases: ['PH'], maxKm: 7500, priceIndex: 0.5, legroom: 29, wifi: 'none', power: false, ife: false,
    carryOn: 'inc', checkedShort: 30, checkedLong: 55, brand: 'Go Basic', changes: 'fee', refund: 'no',
  }),
  lcc('VN TH SG MY KR JP TW IN AU HK CN', {
    code: 'VJ', name: 'VietJet Air', bases: ['VN', 'TH'], maxKm: 7800, priceIndex: 0.5, legroom: 28, wifi: 'none', power: false, ife: false,
    carryOn: 'inc', checkedShort: 30, checkedLong: 55, brand: 'Eco', changes: 'fee', refund: 'no',
  }),

  // --- Oceania ---
  legacy('AU', 'SYD MEL BNE PER', {
    code: 'QF', name: 'Qantas', priceIndex: 1.1, legroom: 31, wifi: 'free', power: true, ife: true,
    carryOn: 'inc', checkedShort: 'inc', checkedLong: 'inc', includedBags: 1, brand: 'Economy Sale', changes: 'fee', refund: 'no',
  }),
  legacy('AU', 'SYD MEL BNE', {
    code: 'VA', maxKm: 8000, name: 'Virgin Australia', priceIndex: 0.92, legroom: 31, wifi: 'paid', power: true, ife: true,
    carryOn: 'inc', checkedShort: 35, checkedLong: 60, brand: 'Lite', changes: 'fee', refund: 'no',
  }),
  legacy('NZ', 'AKL', {
    code: 'NZ', name: 'Air New Zealand', priceIndex: 1.02, legroom: 31, wifi: 'free', power: true, ife: true,
    carryOn: 'inc', checkedShort: 35, checkedLong: 'inc', includedBags: 1, brand: 'Seat', changes: 'fee', refund: 'no',
  }),
  lcc('AU NZ SG JP TH ID VN KR', {
    code: 'JQ', name: 'Jetstar', bases: ['AU', 'NZ'], maxKm: 9500, priceIndex: 0.55, legroom: 29, wifi: 'none', power: false, ife: false,
    carryOn: 'inc', checkedShort: 35, checkedLong: 55, brand: 'Starter', changes: 'fee', refund: 'no',
  }),

  // --- Latin America ---
  legacy('CL BR PE CO EC', 'SCL GRU LIM BOG', {
    code: 'LA', name: 'LATAM', priceIndex: 0.92, legroom: 30, wifi: 'paid', power: true, ife: true,
    carryOn: 'inc', checkedShort: 30, checkedLong: 60, brand: 'Basic', changes: 'no', refund: 'no',
  }),
  legacy('CO', 'BOG', {
    code: 'AV', maxKm: 9000, name: 'Avianca', priceIndex: 0.82, legroom: 29, wifi: 'none', power: true, ife: false,
    carryOn: 35, checkedShort: 45, checkedLong: 70, brand: 'Basic', changes: 'no', refund: 'no',
  }),
  {
    ...legacy('PA', 'PTY', {
      code: 'CM', maxKm: 7000, name: 'Copa Airlines', priceIndex: 0.93, legroom: 31, wifi: 'none', power: true, ife: true,
      carryOn: 'inc', checkedShort: 40, checkedLong: 60, brand: 'Economy Basic', changes: 'no', refund: 'no',
    }),
    connector: true,
  },
  legacy('AR', 'EZE', {
    code: 'AR', name: 'Aerolineas Argentinas', priceIndex: 0.9, legroom: 31, wifi: 'none', power: false, ife: true,
    carryOn: 'inc', checkedShort: 30, checkedLong: 'inc', includedBags: 1, brand: 'Base', changes: 'fee', refund: 'no',
  }),
  lcc('BR AR UY PY CL BO', {
    code: 'G3', name: 'GOL', bases: ['BR'], maxKm: 4800, priceIndex: 0.65, legroom: 30, wifi: 'paid', power: true, ife: false,
    carryOn: 'inc', checkedShort: 25, checkedLong: 45, brand: 'Light', changes: 'fee', refund: 'no',
  }),
];
