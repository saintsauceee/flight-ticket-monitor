import { Backpack, Check, Luggage, Minus } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import type { BagPrefs } from '@shared/bags';
import type { FlightOffer } from '@shared/types';
import { duration, money, plural, stopsLabel } from '@/lib/format';
import { AirlineLogo } from './AirlineLogo';
import { bagRuleText } from './Bags';
import { priceOffer, type OfferPricing } from './OfferCard';
import { cx } from './ui';

interface AirlineRow {
  best: FlightOffer;
  pricing: OfferPricing;
  flights: number;
  fastestMin: number;
}

/** One row per airline: the option that is cheapest once the traveller's bags are added. */
export function compareAirlines(offers: readonly FlightOffer[], bags: BagPrefs, adults: number): AirlineRow[] {
  const rows = new Map<string, AirlineRow>();
  for (const offer of offers) {
    const pricing = priceOffer(offer, bags, adults);
    const row = rows.get(offer.airline.code);
    if (!row) {
      rows.set(offer.airline.code, { best: offer, pricing, flights: 1, fastestMin: offer.durationMin });
      continue;
    }
    row.flights++;
    row.fastestMin = Math.min(row.fastestMin, offer.durationMin);
    if (pricing.total < row.pricing.total) {
      row.best = offer;
      row.pricing = pricing;
    }
  }
  return [...rows.values()].sort((a, b) => a.pricing.total - b.pricing.total);
}

const dash = <Minus className="mx-auto size-3.5 text-ink-3" aria-label="Not stated" />;

function YesNo({ value, yes = 'Yes', no = 'No' }: { value: boolean | null; yes?: string; no?: string }) {
  if (value == null) return dash;
  return value ? (
    <span className="inline-flex items-center gap-1 text-ink-2">
      <Check className="size-3.5 text-good-ink" aria-hidden />
      {yes}
    </span>
  ) : (
    <span className="text-ink-3">{no}</span>
  );
}

function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th scope="col" className={cx('px-2.5 py-2.5 text-left text-xs font-semibold whitespace-nowrap text-ink-3', className)}>
      {children}
    </th>
  );
}

const FLEX = { free: 'Free', fee: 'Fee', no: 'No' } as const;

/**
 * Airlines side by side. The bar splits each total into fare and bag fees, so a
 * cheap fare that turns expensive once bags are added is visible at a glance.
 */
export function AirlineCompare({ offers, bags, adults, currency }: { offers: readonly FlightOffer[]; bags: BagPrefs; adults: number; currency: string }) {
  const rows = useMemo(() => compareAirlines(offers, bags, adults), [offers, bags, adults]);
  const maxTotal = Math.max(...rows.map((r) => r.pricing.total), 1);
  const wantsBags = bags.carryOn + bags.checked > 0;
  const cheapest = rows[0]?.pricing.total;

  if (rows.length === 0) return null;

  return (
    <div className="overflow-hidden rounded-2xl bg-surface shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-b border-line px-5 py-3.5">
        <p className="text-[13px] text-ink-3">
          Cheapest option per airline for {plural(adults, 'traveller')}
          {wantsBags ? `, with ${[bags.carryOn && plural(bags.carryOn, 'carry-on'), bags.checked && plural(bags.checked, 'checked bag')].filter(Boolean).join(' and ')} each` : ', no bags'}
          .
        </p>
        <div className="flex items-center gap-4 text-xs text-ink-2" aria-hidden>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-[3px] bg-(--series-1)" />
            Fare
          </span>
          {wantsBags && (
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-[3px] bg-(--series-2)" />
              Bag fees
            </span>
          )}
        </div>
      </div>

      {/* `relative` keeps the table's screen-reader-only labels inside the scroller; without it they widen the whole page on phones. */}
      <div className="relative overflow-x-auto">
        <table className="w-full min-w-[58rem] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-line bg-surface-2/70">
              <Th className="min-w-40 pl-5">Airline</Th>
              <Th className="w-[21%] min-w-52">Total {wantsBags ? 'with your bags' : '(fare only)'}</Th>
              <Th>Bags</Th>
              <Th>Cheapest flight</Th>
              <Th>Legroom</Th>
              <Th>Wi-Fi</Th>
              <Th>Power</Th>
              <Th>Screen</Th>
              <Th>Changes</Th>
              <Th className="pr-5 text-right">CO₂</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ best, pricing, flights, fastestMin }) => {
              const fareWidth = (best.price / maxTotal) * 100;
              const bagWidth = (pricing.bagFees / maxTotal) * 100;
              const breakdown = `Fare ${money(best.price, currency)}${pricing.bagFees > 0 ? ` + bag fees ${money(pricing.bagFees, currency)}` : ''}${pricing.complete ? '' : ' + bag fees that are not stated'}`;
              return (
                <tr key={best.airline.code} className="border-b border-line last:border-0 hover:bg-surface-2/60">
                  <th scope="row" className="py-3.5 pr-3 pl-5 text-left font-normal">
                    <div className="flex items-center gap-3">
                      <AirlineLogo airline={best.airline} size={32} />
                      <div className="min-w-0">
                        <div className="truncate font-semibold">{best.airline.name}</div>
                        <div className="truncate text-xs text-ink-3">
                          {plural(flights, 'option')}
                          {best.fare.brand && ` · ${best.fare.brand}`}
                        </div>
                      </div>
                    </div>
                  </th>
                  <td className="px-2.5 py-3">
                    <div className="flex items-center gap-2.5" title={breakdown}>
                      <div className="flex h-3 min-w-0 flex-1 items-stretch gap-0.5">
                        <div
                          className={cx('bg-(--series-1)', pricing.bagFees > 0 ? '' : 'rounded-r-[4px]')}
                          style={{ width: `${fareWidth}%` }}
                        />
                        {pricing.bagFees > 0 && <div className="rounded-r-[4px] bg-(--series-2)" style={{ width: `${bagWidth}%` }} />}
                      </div>
                      <div className="w-20 shrink-0 text-right">
                        <span className={cx('tnum text-sm font-bold', pricing.total === cheapest && 'text-good-ink')}>
                          {money(pricing.total, currency)}
                          {!pricing.complete && <span title="A needed bag fee is not stated, so the real total is higher.">+</span>}
                        </span>
                      </div>
                    </div>
                    <div className="tnum mt-1 text-xs whitespace-nowrap text-ink-3">{breakdown}</div>
                  </td>
                  <td className="px-2.5 py-3 whitespace-nowrap text-ink-2">
                    <div className="flex items-center gap-1.5" title="Carry-on bag">
                      <Backpack className="size-3.5 shrink-0 text-ink-3" aria-hidden />
                      <span className="sr-only">Carry-on: </span>
                      {bagRuleText(best.baggage.carryOn, currency)}
                    </div>
                    <div className="mt-1 flex items-center gap-1.5" title="First checked bag">
                      <Luggage className="size-3.5 shrink-0 text-ink-3" aria-hidden />
                      <span className="sr-only">Checked bag: </span>
                      {bagRuleText(best.baggage.checked, currency)}
                    </div>
                  </td>
                  <td className="px-2.5 py-3 whitespace-nowrap">
                    <div className="tnum text-ink-2">
                      {stopsLabel(best.stops)} · {duration(best.durationMin)}
                    </div>
                    {fastestMin < best.durationMin && <div className="tnum text-xs text-ink-3">fastest {duration(fastestMin)}</div>}
                  </td>
                  <td className="tnum px-2.5 py-3 whitespace-nowrap text-ink-2">
                    {best.amenities.seat ?? (best.amenities.legroomIn != null ? `${best.amenities.legroomIn} in` : dash)}
                  </td>
                  <td className="px-2.5 py-3 whitespace-nowrap">
                    {best.amenities.wifi == null ? dash : best.amenities.wifi === 'none' ? <span className="text-ink-3">No</span> : <YesNo value yes={best.amenities.wifi === 'free' ? 'Free' : 'Paid'} />}
                  </td>
                  <td className="px-2.5 py-3 whitespace-nowrap">
                    <YesNo value={best.amenities.power} />
                  </td>
                  <td className="px-2.5 py-3 whitespace-nowrap">
                    <YesNo value={best.amenities.entertainment} />
                  </td>
                  <td className="px-2.5 py-3 whitespace-nowrap text-ink-2">{best.fare.changes ? FLEX[best.fare.changes] : dash}</td>
                  <td className="tnum py-3 pr-5 pl-3 text-right whitespace-nowrap text-ink-2">
                    {best.emissionsKg != null ? `${best.emissionsKg.toLocaleString()} kg` : dash}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
