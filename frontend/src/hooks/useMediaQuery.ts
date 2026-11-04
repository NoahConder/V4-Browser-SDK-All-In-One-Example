import { useSyncExternalStore } from 'react';

// Wide enough for the workbench (Destinations | phone | Inspector, see
// components/Workbench.tsx). The height clause keeps landscape phones on the
// phone layout, same as the `desk` screen in tailwind.config.js.
export const WORKBENCH_QUERY = '(min-width: 1024px) and (min-height: 501px)';

// Live `matchMedia` result; re-renders on resize across the breakpoint.
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
  );
}
