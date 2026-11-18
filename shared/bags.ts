import type { BagRule, FlightOffer } from './types';

/** Bags each traveller wants to bring. */
export interface BagPrefs {
  carryOn: number;
  checked: number;
}

export const DEFAULT_BAG_PREFS: BagPrefs = { carryOn: 1, checked: 0 };

export interface BagCost {
  /** Known bag fees for all travellers. A lower bound when `complete` is false. */
  cost: number;
  /** False when at least one needed fee is not known. */
  complete: boolean;
}

function ruleCost(rule: BagRule, wanted: number): { perTraveller: number; known: boolean } {
  if (wanted <= 0) return { perTraveller: 0, known: true };
  if (rule.status === 'unknown') return { perTraveller: 0, known: false };
  const included = rule.status === 'included' ? (rule.quantity ?? 1) : 0;
  const extra = Math.max(0, wanted - included);
  if (extra === 0) return { perTraveller: 0, known: true };
  if (rule.fee == null) return { perTraveller: 0, known: false };
  // Providers report the fee for the first bag only; additional bags are
  // assumed to cost the same, which is usually a slight underestimate.
  return { perTraveller: extra * rule.fee, known: true };
}

/** Extra cost of bringing `prefs` bags on `offer` for `travellers` people. */
export function bagCost(offer: Pick<FlightOffer, 'baggage'>, prefs: BagPrefs, travellers: number): BagCost {
  const carry = ruleCost(offer.baggage.carryOn, prefs.carryOn);
  const checked = ruleCost(offer.baggage.checked, prefs.checked);
  return {
    cost: (carry.perTraveller + checked.perTraveller) * Math.max(1, travellers),
    complete: carry.known && checked.known,
  };
}

/** Ticket price plus the bags the traveller wants. */
export function totalWithBags(
  offer: Pick<FlightOffer, 'baggage' | 'price'>,
  prefs: BagPrefs,
  travellers: number,
): { total: number; bagFees: number; complete: boolean } {
  const { cost, complete } = bagCost(offer, prefs, travellers);
  return { total: offer.price + cost, bagFees: cost, complete };
}
