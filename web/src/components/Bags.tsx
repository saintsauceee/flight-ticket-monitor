import { Backpack, Check, CircleHelp, Luggage } from 'lucide-react';
import type { BagPrefs } from '@shared/bags';
import type { BagRule } from '@shared/types';
import { money } from '@/lib/format';
import { setPrefs } from '@/lib/prefs';
import { cx, Segmented } from './ui';

/**
 * Lets the traveller say which bags they bring; every total on the page then
 * includes them. Both at 0 means no preference: totals are the fare alone.
 */
export function BagPrefsControl({ prefs, label = true }: { prefs: BagPrefs; label?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {/* Phones: the label takes its own line so the two pickers stay side by side. */}
      {label && <span className="text-[13px] font-semibold text-ink-2 max-sm:w-full">Bags per traveller</span>}
      <label className="flex items-center gap-2 text-[13px] text-ink-3">
        <Backpack className="size-4" aria-hidden />
        Carry-on
        <Segmented
          size="sm"
          label="Carry-on bags per traveller"
          value={String(prefs.carryOn)}
          onChange={(v) => setPrefs({ bags: { ...prefs, carryOn: Number(v) } })}
          options={[
            { value: '0', label: '0' },
            { value: '1', label: '1' },
          ]}
        />
      </label>
      <label className="flex items-center gap-2 text-[13px] text-ink-3">
        <Luggage className="size-4" aria-hidden />
        Checked
        <Segmented
          size="sm"
          label="Checked bags per traveller"
          value={String(prefs.checked)}
          onChange={(v) => setPrefs({ bags: { ...prefs, checked: Number(v) } })}
          options={[
            { value: '0', label: '0' },
            { value: '1', label: '1' },
            { value: '2', label: '2' },
          ]}
        />
      </label>
    </div>
  );
}

export function bagRuleText(rule: BagRule, currency: string): string {
  if (rule.status === 'included') {
    const count = rule.quantity && rule.quantity > 1 ? `${rule.quantity} included` : 'Included';
    return rule.note ? `${count} (${rule.note})` : count;
  }
  if (rule.status === 'fee') {
    if (rule.fee == null) return 'Extra fee';
    return rule.feeMax != null && rule.feeMax !== rule.fee ? `${money(rule.fee, currency)}–${money(rule.feeMax, currency)}` : money(rule.fee, currency);
  }
  return 'Not stated';
}

/** One bag type as icon + words; colour reinforces the state but never carries it alone. */
export function BagChip({ kind, rule, currency, compact = false }: { kind: 'carryOn' | 'checked'; rule: BagRule; currency: string; compact?: boolean }) {
  const Icon = kind === 'carryOn' ? Backpack : Luggage;
  const name = kind === 'carryOn' ? 'Carry-on' : 'Checked bag';
  const text = bagRuleText(rule, currency);
  return (
    <span
      title={`${name}: ${text}${rule.status === 'fee' && rule.fee != null ? ' per traveller for the whole trip' : ''}`}
      className={cx(
        'inline-flex h-6 items-center gap-1 rounded-full px-2 text-xs font-semibold whitespace-nowrap',
        rule.status === 'included' ? 'bg-good-soft text-good-ink' : rule.status === 'fee' ? 'bg-warn-soft text-warn-ink' : 'bg-ink/[0.07] text-ink-3',
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      <span className="sr-only">{name}: </span>
      {rule.status === 'included' ? (
        <>
          <Check className="size-3" aria-hidden />
          {compact ? (rule.quantity && rule.quantity > 1 ? `×${rule.quantity}` : <span className="sr-only">Included</span>) : text}
        </>
      ) : rule.status === 'fee' ? (
        (rule.fee == null ? 'Fee' : `+${money(rule.fee, currency)}`)
      ) : (
        <>
          <CircleHelp className="size-3" aria-hidden />
          <span className="sr-only">Not stated</span>
        </>
      )}
    </span>
  );
}
