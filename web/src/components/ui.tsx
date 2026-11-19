import { AlertTriangle, ArrowRight, ChevronDown, Loader2 } from 'lucide-react';
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

/** "glass" is for buttons that sit on the navy band; "destroy" confirms a deletion. */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'destroy' | 'glass';
/** "xl" is the search form's submit button: as tall as the fields beside it. */
export type ButtonSize = 'sm' | 'md' | 'lg' | 'xl';

const BUTTON_BASE =
  'tap-target inline-flex shrink-0 items-center justify-center gap-1.5 font-semibold whitespace-nowrap transition-[background-color,filter,color,box-shadow,transform] select-none active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-55 disabled:active:scale-100';

// Hover and press always raise contrast with the label: filled buttons darken, tinted ones get denser.
const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-on-accent shadow-btn hover:bg-accent-hover',
  secondary: 'bg-surface text-ink shadow-control ring-1 ring-inset ring-line-strong/80 hover:bg-surface-2 hover:ring-line-strong',
  ghost: 'text-ink-2 hover:bg-ink/[0.06] hover:text-ink',
  danger: 'bg-surface text-bad-ink ring-1 ring-inset ring-bad/40 hover:bg-bad-soft',
  destroy: 'bg-bad text-white hover:brightness-90',
  glass: 'bg-white/10 text-white ring-1 ring-inset ring-white/15 hover:bg-white/[0.17] hover:ring-white/25',
};

// The corner radius grows with the height, so every size has the same proportions.
const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 rounded-lg px-3 text-[13px]',
  md: 'h-10 rounded-control px-4 text-sm',
  lg: 'h-12 rounded-xl px-5 text-[15px]',
  xl: 'h-14 rounded-2xl px-7 text-base',
};

/** The button look as a class string, for links that should read as buttons. */
export function buttonClass(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md', className?: string): string {
  return cx(BUTTON_BASE, BUTTON_SIZES[size], BUTTON_VARIANTS[variant], className);
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize; loading?: boolean }) {
  return (
    <button type="button" {...rest} disabled={disabled || loading} className={buttonClass(variant, size, className)}>
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function Card({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={cx('rounded-2xl bg-surface shadow-card', className)}>
      {children}
    </div>
  );
}

export function SectionTitle({ children, hint, action }: { children: ReactNode; hint?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <div>
        <h2 className="display text-lg leading-snug font-bold">{children}</h2>
        {hint && <p className="mt-0.5 text-[13px] text-ink-3">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

/** "Montréal → Tokyo" as a heading's content. */
export function RouteTitle({ from, to, iconClassName }: { from: string; to: string; iconClassName?: string }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-[0.4em]">
      {from}
      <ArrowRight className={cx('size-[0.8em] shrink-0 opacity-45', iconClassName)} strokeWidth={2.75} aria-label="to" />
      {to}
    </span>
  );
}

type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'accent';

const TONES: Record<Tone, string> = {
  neutral: 'bg-ink/[0.07] text-ink-2',
  good: 'bg-good-soft text-good-ink',
  warn: 'bg-warn-soft text-warn-ink',
  bad: 'bg-bad-soft text-bad-ink',
  accent: 'bg-accent-soft text-accent-strong',
};

export function Badge({ tone = 'neutral', className, children, ...rest }: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      {...rest}
      className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap', TONES[tone], className)}
    >
      {children}
    </span>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  size = 'md',
}: {
  value: T;
  onChange: (value: T) => void;
  options: readonly { value: T; label: ReactNode; title?: string }[];
  label: string;
  size?: 'sm' | 'md';
}) {
  return (
    // The track is a tint of the text colour, so it shows on cards and on the page alike.
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-full bg-ink/[0.07] p-[3px]">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            title={option.title}
            onClick={() => onChange(option.value)}
            className={cx(
              'tap-target rounded-full font-semibold whitespace-nowrap transition-colors select-none',
              size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-1.5 text-[13px]',
              selected ? 'bg-raised text-ink shadow-sm' : 'text-ink-3 hover:text-ink',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Dropdown with its own chevron. The browser's built-in arrow sits flush against
 * the edge and ignores padding, so it is replaced rather than styled.
 */
export function Select({
  label,
  value,
  onChange,
  children,
  variant = 'soft',
  size = 'md',
  className,
  id,
  disabled,
}: {
  /** Accessible name; leave out when a visible <label> points at `id`. */
  label?: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  /** "bare" has no box of its own: it sits inside a `Field`. */
  variant?: 'soft' | 'outline' | 'bare';
  /** "lg" matches the height of text inputs. */
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  id?: string;
  disabled?: boolean;
}) {
  const bare = variant === 'bare';
  return (
    <span className={cx('relative inline-flex', className)}>
      <select
        id={id}
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={cx(
          'w-full appearance-none truncate transition-colors disabled:cursor-not-allowed',
          bare
            ? cx(fieldInputClass, 'pr-9!')
            : size === 'sm'
              ? 'h-[30px] rounded-full pr-7 pl-3 text-xs font-semibold'
              : size === 'lg'
                ? 'h-10 rounded-control pr-9 pl-3 text-sm font-medium'
                : 'h-9 rounded-full pr-9 pl-3.5 text-[13px] font-semibold',
          variant === 'outline' && 'bg-surface text-ink shadow-control ring-1 ring-inset ring-line-strong/80 hover:ring-line-strong',
          variant === 'soft' && 'bg-ink/[0.07] text-ink-2 hover:bg-ink/[0.1] hover:text-ink',
        )}
      >
        {children}
      </select>
      <ChevronDown
        className={cx(
          'pointer-events-none absolute text-ink-3',
          bare ? 'right-3 bottom-3 size-4' : size === 'sm' ? 'top-1/2 right-2.5 size-3.5 -translate-y-1/2' : 'top-1/2 right-3 size-4 -translate-y-1/2',
        )}
        aria-hidden
      />
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('size-4 animate-spin text-ink-3', className)} aria-label="Loading" />;
}

export function ErrorNote({ title = 'Something went wrong', message, action }: { title?: string; message: string; action?: ReactNode }) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-2xl border border-bad/25 bg-bad-soft px-4 py-3.5">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-bad-ink" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-bad-ink">{title}</p>
        <p className="mt-0.5 text-[13px] break-words text-ink-2">{message}</p>
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-line-strong bg-surface/60 px-6 py-16 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent-strong">{icon}</div>
      <h3 className="display text-lg font-bold">{title}</h3>
      {children && <div className="mt-1.5 max-w-md text-[13px] text-ink-3">{children}</div>}
      {action && <div className="mt-6 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('skeleton', className)} aria-hidden />;
}

export function FieldLabel({ htmlFor, children }: { htmlFor?: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-semibold text-ink-3">
      {children}
    </label>
  );
}

/** Text inputs are 16px on phones: anything smaller makes iOS zoom the page when the field is focused. */
export const inputClass =
  'h-10 w-full rounded-control bg-surface px-3 text-base text-ink shadow-control ring-1 ring-inset ring-line-strong/80 placeholder:text-ink-3 transition-shadow hover:ring-line-strong focus:ring-2 focus:ring-accent focus-visible:outline-none sm:text-sm';

/**
 * A large input tile with its label inside, as used by the search form. The
 * tile draws the focus ring, so the control inside it has none of its own.
 */
export function Field({
  label,
  htmlFor,
  children,
  className,
  labelClassName,
  disabled = false,
  invalid = false,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
  className?: string;
  /** Extra classes for the label, for example to move it clear of a neighbouring control. */
  labelClassName?: string;
  disabled?: boolean;
  invalid?: boolean;
}) {
  return (
    <div
      className={cx(
        'relative rounded-2xl bg-surface-2 ring-1 ring-inset transition-[background-color,box-shadow] focus-within:bg-surface focus-within:ring-2 focus-within:ring-accent',
        // The hover edge must not apply while focused, or it would replace the focus ring under the pointer.
        invalid ? 'ring-bad/70' : 'ring-line not-focus-within:hover:ring-line-strong',
        disabled && 'opacity-50',
        className,
      )}
    >
      <label htmlFor={htmlFor} className={cx('eyebrow pointer-events-none absolute top-2 left-3.5', labelClassName)}>
        {label}
      </label>
      {children}
    </div>
  );
}

/** The control inside a `Field`: transparent, with room at the top for the label. */
export const fieldInputClass =
  'h-14 w-full rounded-2xl bg-transparent pt-5 pl-3.5 pr-3.5 text-base font-semibold text-ink placeholder:font-medium placeholder:text-ink-3 focus-visible:outline-none disabled:cursor-not-allowed sm:text-[15px]';

/** Small labelled figure used in summary rows. */
export function Stat({ label, value, sub, className }: { label: string; value: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="text-xs font-medium text-ink-3">{label}</div>
      <div className="display mt-1 text-xl leading-tight font-bold">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-ink-3">{sub}</div>}
    </div>
  );
}
