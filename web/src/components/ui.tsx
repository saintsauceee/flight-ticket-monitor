import { AlertTriangle, ChevronDown, Loader2 } from 'lucide-react';
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-on-accent hover:brightness-110 active:brightness-95 shadow-sm',
  secondary: 'bg-surface text-ink border border-line-strong/70 hover:bg-surface-2 active:bg-surface-3',
  ghost: 'text-ink-2 hover:bg-surface-2 hover:text-ink active:bg-surface-3',
  danger: 'text-bad-ink border border-line-strong/70 bg-surface hover:bg-bad-soft',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: 'sm' | 'md' | 'lg'; loading?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || loading}
      className={cx(
        'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg font-medium whitespace-nowrap transition-[background-color,filter,color] select-none',
        'disabled:cursor-not-allowed disabled:opacity-55',
        size === 'sm' ? 'h-8 px-2.5 text-[13px]' : size === 'lg' ? 'h-11 px-5 text-[15px]' : 'h-9 px-3.5 text-sm',
        BUTTON_VARIANTS[variant],
        className,
      )}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function Card({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={cx('rounded-xl border border-line bg-surface shadow-card', className)}>
      {children}
    </div>
  );
}

export function SectionTitle({ children, hint, action }: { children: ReactNode; hint?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
      <div>
        <h2 className="text-[15px] font-semibold tracking-tight">{children}</h2>
        {hint && <p className="mt-0.5 text-[13px] text-ink-3">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'accent';

const TONES: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-ink-2',
  good: 'bg-good-soft text-good-ink',
  warn: 'bg-warn-soft text-warn-ink',
  bad: 'bg-bad-soft text-bad-ink',
  accent: 'bg-accent-soft text-accent-strong',
};

export function Badge({ tone = 'neutral', className, children, ...rest }: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      {...rest}
      className={cx('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium whitespace-nowrap', TONES[tone], className)}
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
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg bg-surface-2 p-0.5">
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
              'rounded-md font-medium whitespace-nowrap transition-colors',
              size === 'sm' ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-[13px]',
              selected ? 'bg-surface text-ink shadow-sm ring-1 ring-line' : 'text-ink-3 hover:text-ink',
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
  variant?: 'soft' | 'outline';
  /** "lg" matches the height of text inputs. */
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  id?: string;
  disabled?: boolean;
}) {
  return (
    <span className={cx('relative inline-flex', className)}>
      <select
        id={id}
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={cx(
          'w-full appearance-none truncate rounded-lg transition-colors disabled:cursor-not-allowed',
          size === 'sm' ? 'h-7 pr-7 pl-2.5 text-xs font-medium' : size === 'lg' ? 'h-10 pr-9 pl-3 text-sm' : 'h-9 pr-9 pl-3 text-[13px] font-medium',
          variant === 'outline' ? 'border border-line-strong/70 bg-surface text-ink hover:border-line-strong' : 'bg-surface-2 text-ink-2 hover:text-ink',
        )}
      >
        {children}
      </select>
      <ChevronDown
        className={cx('pointer-events-none absolute top-1/2 -translate-y-1/2 text-ink-3', size === 'sm' ? 'right-2 size-3.5' : 'right-2.5 size-4')}
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
    <div role="alert" className="flex items-start gap-3 rounded-xl border border-bad/25 bg-bad-soft px-4 py-3">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-bad-ink" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-bad-ink">{title}</p>
        <p className="mt-0.5 text-[13px] break-words text-ink-2">{message}</p>
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-line-strong/70 px-6 py-14 text-center">
      <div className="mb-4 flex size-11 items-center justify-center rounded-full bg-surface-2 text-ink-3">{icon}</div>
      <h3 className="text-[15px] font-semibold">{title}</h3>
      {children && <div className="mt-1.5 max-w-md text-[13px] text-ink-3">{children}</div>}
      {action && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('skeleton', className)} aria-hidden />;
}

export function FieldLabel({ htmlFor, children }: { htmlFor?: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-xs font-medium text-ink-3">
      {children}
    </label>
  );
}

export const inputClass =
  'h-10 w-full rounded-lg border border-line-strong/70 bg-surface px-3 text-sm text-ink placeholder:text-ink-3 transition-colors hover:border-line-strong focus:border-accent focus:outline-2 focus:outline-offset-0 focus:outline-accent/30';

/** Small labelled figure used in summary rows. */
export function Stat({ label, value, sub, className }: { label: string; value: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="text-xs text-ink-3">{label}</div>
      <div className="mt-0.5 text-lg leading-tight font-semibold tracking-tight">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-ink-3">{sub}</div>}
    </div>
  );
}
