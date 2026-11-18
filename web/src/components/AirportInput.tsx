import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import type { Airport } from '@shared/types';
import { api } from '@/lib/api';
import { cx, FieldLabel, inputClass } from './ui';

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

const regionNames = new Intl.DisplayNames(undefined, { type: 'region' });
function country(code: string): string {
  try {
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
}

/** Airport picker: type a city, airport name or code and choose from the list. */
export function AirportInput({
  label,
  value,
  onChange,
  placeholder,
  invalid = false,
}: {
  label: string;
  value: Airport | null;
  onChange: (airport: Airport | null) => void;
  placeholder?: string;
  invalid?: boolean;
}) {
  const id = useId();
  const listId = `${id}-list`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const term = useDebounced(text.trim(), 120);

  const { data: options = [], isFetching } = useQuery({
    queryKey: ['airports', term],
    queryFn: () => api.airports(term),
    enabled: open,
    staleTime: Infinity,
    placeholderData: (previous) => previous,
  });

  useEffect(() => {
    setActive(0);
  }, [term]);

  const choose = (airport: Airport) => {
    onChange(airport);
    setText('');
    setOpen(false);
    inputRef.current?.blur();
  };

  const display = open ? text : value ? `${value.city} (${value.code})` : '';

  return (
    <div className="relative min-w-0">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <input
        ref={inputRef}
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && options[active] ? `${id}-${options[active].code}` : undefined}
        aria-invalid={invalid}
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder ?? 'City or airport'}
        value={display}
        className={cx(inputClass, 'truncate font-medium', invalid && 'border-bad/70')}
        onFocus={(e) => {
          setOpen(true);
          setText('');
          e.currentTarget.select();
        }}
        onBlur={() => setOpen(false)}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setActive((i) => Math.min(i + 1, options.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === 'Enter' && open && options[active]) {
            e.preventDefault();
            choose(options[active]);
          } else if (e.key === 'Escape') {
            setOpen(false);
            inputRef.current?.blur();
          }
        }}
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={label}
          // Keep focus in the input while the pointer is on the list.
          onMouseDown={(e) => e.preventDefault()}
          className="absolute top-full left-0 z-30 mt-1.5 max-h-80 w-[min(22rem,calc(100vw-2rem))] overflow-auto rounded-xl border border-line bg-surface p-1 shadow-pop"
        >
          {options.length === 0 && (
            <li className="px-3 py-2.5 text-[13px] text-ink-3">{isFetching ? 'Searching…' : term ? `No airports match “${term}”` : 'Type a city or airport'}</li>
          )}
          {options.map((airport, i) => (
            <li
              key={airport.code}
              id={`${id}-${airport.code}`}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(airport)}
              className={cx('flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2', i === active && 'bg-surface-2')}
            >
              <span className="code-face w-10 shrink-0 text-center text-[13px] font-semibold text-ink-2">{airport.code}</span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">
                  {airport.city}
                  <span className="font-normal text-ink-3">, {country(airport.country)}</span>
                </span>
                <span className="block truncate text-xs text-ink-3">{airport.name}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
