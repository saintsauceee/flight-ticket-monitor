import { Armchair, ChevronDown, Clock, Leaf, MonitorPlay, Plug, Receipt, Wifi } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { totalWithBags, type BagPrefs } from '@shared/bags';
import type { Airport, FlightOffer, Slice } from '@shared/types';
import { clock, day, dayShift, duration, money, plural, stopsLabel } from '@/lib/format';
import { AirlineLogo } from './AirlineLogo';
import { BagChip, bagRuleText } from './Bags';
import { Badge, Button, cx } from './ui';

export interface OfferPricing {
  total: number;
  bagFees: number;
  complete: boolean;
  wantsBags: boolean;
}

export function priceOffer(offer: FlightOffer, bags: BagPrefs, adults: number): OfferPricing {
  return { ...totalWithBags(offer, bags, adults), wantsBags: bags.carryOn + bags.checked > 0 };
}

/** One direction of the trip: departure and arrival at the ends of a line, the duration and stops along it. */
function SliceRow({ slice, label }: { slice: Slice; label: string | null }) {
  const first = slice.segments[0];
  const last = slice.segments[slice.segments.length - 1];
  if (!first || !last) return null;
  const shift = dayShift(first.departAt, last.arriveAt);
  const numbers = slice.segments.map((s) => s.flightNumber).join(', ');
  return (
    <div className="flex items-center gap-x-3 sm:gap-x-4" title={`${first.from}–${last.to} · ${numbers}`}>
      {label && <span className="eyebrow w-9 shrink-0">{label}</span>}
      <div className="w-[4.5rem] shrink-0">
        <div className="tnum text-base leading-tight font-bold tracking-tight whitespace-nowrap">{clock(first.departAt)}</div>
        <div className="code-face mt-0.5 text-xs text-ink-3">{first.from}</div>
      </div>
      <div className="min-w-12 flex-1 text-center">
        <div className="tnum text-xs font-semibold text-ink-2">{duration(slice.durationMin)}</div>
        <div className="relative my-1.5 h-0.5 rounded-full bg-line-strong/70" aria-hidden>
          <span className="absolute top-1/2 left-0 size-1.5 -translate-y-1/2 rounded-full bg-ink-3" />
          {slice.layovers.map((layover, i) => (
            <span
              key={`${layover.airport}-${i}`}
              className="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-surface ring-2 ring-ink-3"
              style={{ left: `${((i + 1) / (slice.layovers.length + 1)) * 100}%` }}
            />
          ))}
          <span className="absolute top-1/2 right-0 size-1.5 -translate-y-1/2 rounded-full bg-ink-3" />
        </div>
        <div className="truncate text-xs text-ink-3">
          {stopsLabel(slice.stops)}
          {slice.layovers.length > 0 && <span className="code-face"> · {slice.layovers.map((l) => l.airport).join(', ')}</span>}
        </div>
      </div>
      <div className="w-[5.25rem] shrink-0 text-right">
        <div className="tnum text-base leading-tight font-bold tracking-tight whitespace-nowrap">
          {clock(last.arriveAt)}
          {shift !== 0 && (
            <sup className="ml-0.5 text-[10px] font-semibold text-ink-3" title={`Arrives ${day(last.arriveAt)}`}>
              {shift > 0 ? `+${shift}` : shift}
            </sup>
          )}
        </div>
        <div className="code-face mt-0.5 text-xs text-ink-3">{last.to}</div>
      </div>
    </div>
  );
}

function DetailBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h4 className="eyebrow mb-2">{title}</h4>
      <dl className="space-y-1 text-[13px]">{children}</dl>
    </div>
  );
}

function Row({ icon, label, value }: { icon?: ReactNode; label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="flex shrink-0 items-center gap-1.5 text-ink-3">
        {icon}
        {label}
      </dt>
      <dd className="text-right font-medium text-ink-2">{value}</dd>
    </div>
  );
}

const FLEX_TEXT = { free: 'Free', fee: 'For a fee', no: 'Not allowed' } as const;
const unknown = <span className="font-normal text-ink-3">Not stated</span>;

function Itinerary({ slice, airports, title }: { slice: Slice; airports: Record<string, Airport>; title: string }) {
  const place = (code: string) => airports[code]?.city ?? code;
  return (
    <div>
      <h4 className="eyebrow mb-2.5">
        {title} · {day(slice.segments[0]?.departAt ?? '')}
      </h4>
      <ol className="space-y-2">
        {slice.segments.map((segment, i) => {
          const layover = slice.layovers[i];
          const shift = dayShift(segment.departAt, segment.arriveAt);
          return (
            <li key={`${segment.flightNumber}-${segment.departAt}`}>
              <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 text-[13px]">
                <div className="tnum font-medium">{clock(segment.departAt)}</div>
                <div className="min-w-0 truncate">
                  {place(segment.from)} <span className="code-face text-ink-3">{segment.from}</span>
                </div>
                <div className="tnum font-medium">
                  {clock(segment.arriveAt)}
                  {shift !== 0 && <sup className="ml-0.5 text-[10px] text-ink-3">{shift > 0 ? `+${shift}` : shift}</sup>}
                </div>
                <div className="min-w-0 truncate">
                  {place(segment.to)} <span className="code-face text-ink-3">{segment.to}</span>
                </div>
                <div />
                <div className="mt-0.5 text-xs text-ink-3">
                  {segment.airlineName} {segment.flightNumber} · {duration(segment.durationMin)}
                  {segment.aircraft && ` · ${segment.aircraft}`}
                  {segment.operatedBy && ` · operated by ${segment.operatedBy}`}
                </div>
              </div>
              {layover && (
                <div className="my-2 ml-[6.25rem] flex items-center gap-1.5 rounded-lg bg-ink/[0.06] px-2.5 py-1.5 text-xs text-ink-2">
                  <Clock className="size-3.5 text-ink-3" aria-hidden />
                  {duration(layover.durationMin)} layover in {place(layover.airport)}
                  {layover.overnight && ' (overnight)'}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function OfferCard({
  offer,
  pricing,
  adults,
  airports,
  roundTrip,
  tags = [],
  onLoadDetails,
  loadingDetails = false,
  detailsError = null,
}: {
  offer: FlightOffer;
  pricing: OfferPricing;
  adults: number;
  airports: Record<string, Airport>;
  roundTrip: boolean;
  tags?: string[];
  /** Present when fare rules and bag fees can be fetched on demand. */
  onLoadDetails?: () => void;
  loadingDetails?: boolean;
  detailsError?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const { currency, baggage, amenities, fare } = offer;
  const panelId = `offer-${offer.id}`;
  const carriers = offer.airlines.map((a) => a.name).join(' + ');
  const returnMissing = roundTrip && offer.slices.length < 2;
  const meta = (
    <div className="flex flex-wrap items-center gap-1.5 text-[13px] text-ink-2">
      <span className="truncate font-medium">{carriers}</span>
      {tags.map((tag) => (
        <Badge key={tag} tone={tag === 'Cheapest' ? 'good' : 'accent'}>
          {tag}
        </Badge>
      ))}
      {offer.oftenDelayed && <Badge tone="warn">Often delayed 30+ min</Badge>}
      {returnMissing && <Badge title="The price covers both directions; the provider lists return flights at booking.">Return chosen at booking</Badge>}
    </div>
  );

  return (
    <article className={cx('rounded-2xl bg-surface transition-shadow hover:shadow-lift', open ? 'shadow-lift' : 'shadow-card')}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-3.5 rounded-2xl px-4 py-4 text-left sm:grid-cols-[auto_minmax(0,1fr)_auto_auto_auto] sm:gap-x-6 sm:px-5"
      >
        <AirlineLogo airline={offer.airline} size={44} />

        {/* Phones: airline beside the logo, flights on their own full-width row below. */}
        <div className="min-w-0 sm:hidden">{meta}</div>

        <div className="col-span-3 min-w-0 space-y-3 sm:col-span-1">
          {offer.slices.map((slice, i) => (
            <SliceRow key={i} slice={slice} label={offer.slices.length > 1 ? (i === 0 ? 'Out' : 'Back') : null} />
          ))}
          <div className="max-sm:hidden">{meta}</div>
        </div>

        <div className="col-span-3 flex flex-wrap gap-1.5 sm:col-span-1 sm:w-28 sm:flex-col sm:items-start">
          <BagChip kind="carryOn" rule={baggage.carryOn} currency={currency} compact />
          <BagChip kind="checked" rule={baggage.checked} currency={currency} compact />
        </div>

        <div className="col-start-3 row-start-1 text-right sm:col-start-auto sm:row-start-auto sm:w-36">
          <div className="display text-[1.4rem] leading-tight font-extrabold">{money(pricing.total, currency)}</div>
          <div className="mt-0.5 text-xs text-ink-3">
            {!pricing.wantsBags ? (
              adults > 1 ? `fare for ${adults}` : 'fare only'
            ) : !pricing.complete ? (
              <span className="text-warn-ink">plus bag fees not stated</span>
            ) : pricing.bagFees > 0 ? (
              `${money(offer.price, currency)} + ${money(pricing.bagFees, currency)} bags`
            ) : (
              'your bags included'
            )}
          </div>
        </div>

        <span className={cx('hidden size-8 items-center justify-center rounded-full text-ink-3 transition-[background-color,transform] sm:flex', open ? 'rotate-180 bg-ink/[0.07]' : 'bg-transparent')} aria-hidden>
          <ChevronDown className="size-4" />
        </span>
      </button>

      {open && (
        <div id={panelId} className="fade-up rounded-b-2xl border-t border-line bg-surface-2/50 px-4 py-5 sm:px-5">
          <div className="grid gap-x-8 gap-y-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
            <div className="space-y-5">
              {offer.slices.map((slice, i) => (
                <Itinerary key={i} slice={slice} airports={airports} title={i === 0 ? 'Outbound' : 'Return'} />
              ))}
              {returnMissing && (
                <p className="text-[13px] text-ink-3">The price is for the round trip. This data source lists the matching return flights only when you load fare details.</p>
              )}
            </div>

            <div className="grid content-start gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              <DetailBlock title="Bags">
                <Row label="Carry-on" value={bagRuleText(baggage.carryOn, currency)} />
                <Row label="Checked bag" value={bagRuleText(baggage.checked, currency)} />
                <p className="pt-0.5 text-xs text-ink-3">
                  {baggage.source === 'simulated'
                    ? 'Simulated fees, per traveller for the whole trip.'
                    : baggage.source === 'fare_details'
                      ? 'From the booking options; fees are per traveller for the whole trip.'
                      : 'From the search listing. Load fare details for exact fees.'}
                </p>
              </DetailBlock>

              <DetailBlock title="Fare">
                <Row icon={<Receipt className="size-3.5" aria-hidden />} label="Fare type" value={fare.brand ?? unknown} />
                <Row label="Changes" value={fare.changes ? FLEX_TEXT[fare.changes] : unknown} />
                <Row label="Refund" value={fare.refund ? FLEX_TEXT[fare.refund] : unknown} />
                <Row label="Seat choice" value={fare.seatSelection ? FLEX_TEXT[fare.seatSelection] : unknown} />
              </DetailBlock>

              <DetailBlock title="On board">
                <Row
                  icon={<Armchair className="size-3.5" aria-hidden />}
                  label="Legroom"
                  value={
                    amenities.seat ??
                    (amenities.legroomIn != null
                      ? `${amenities.legroomIn} in${amenities.legroomRating ? ` · ${amenities.legroomRating === 'average' ? 'average' : `${amenities.legroomRating} average`}` : ''}`
                      : unknown)
                  }
                />
                <Row
                  icon={<Wifi className="size-3.5" aria-hidden />}
                  label="Wi-Fi"
                  value={amenities.wifi == null ? unknown : amenities.wifi === 'free' ? 'Free' : amenities.wifi === 'paid' ? 'For a fee' : 'None'}
                />
                <Row icon={<Plug className="size-3.5" aria-hidden />} label="Power" value={amenities.power == null ? unknown : amenities.power ? 'Yes' : 'No'} />
                <Row
                  icon={<MonitorPlay className="size-3.5" aria-hidden />}
                  label="Entertainment"
                  value={amenities.entertainment == null ? unknown : amenities.entertainment ? 'Yes' : 'No'}
                />
              </DetailBlock>

              <DetailBlock title="Trip">
                <Row label="Price" value={`${money(offer.price, currency)} for ${plural(adults, 'traveller')}`} />
                <Row
                  icon={<Leaf className="size-3.5" aria-hidden />}
                  label="Emissions"
                  value={offer.emissionsKg == null ? unknown : `${offer.emissionsKg.toLocaleString()} kg CO₂`}
                />
                {offer.emissionsKg != null && (
                  <p className="pt-0.5 text-xs text-ink-3">
                    Per traveller
                    {offer.emissionsDiffPct != null &&
                      offer.emissionsDiffPct !== 0 &&
                      `, ${Math.abs(offer.emissionsDiffPct)}% ${offer.emissionsDiffPct > 0 ? 'more' : 'less'} than typical for this route`}
                    .
                  </p>
                )}
              </DetailBlock>
            </div>
          </div>

          {offer.details === 'available' && onLoadDetails && (
            <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-3">
              <Button size="sm" onClick={onLoadDetails} loading={loadingDetails}>
                Load fare details and bag fees
              </Button>
              <span className="text-xs text-ink-3">Uses {plural(offer.detailsCost, 'search', 'searches')} from your monthly budget.</span>
              {detailsError && <span className="text-xs font-medium text-bad-ink">{detailsError}</span>}
            </div>
          )}
        </div>
      )}
    </article>
  );
}
