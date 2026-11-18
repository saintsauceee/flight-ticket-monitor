import { useEffect } from 'react';

const BASE = 'Flight Monitor';

/** Sets the browser tab title for the current page. */
export function useTitle(title: string | null): void {
  useEffect(() => {
    document.title = title ? `${title} · ${BASE}` : BASE;
    return () => {
      document.title = BASE;
    };
  }, [title]);
}
