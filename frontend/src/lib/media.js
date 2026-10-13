import { useEffect, useState } from 'react';

// one breakpoint for the "phone shell": below it the HUD switches to the
// compact burger layout with collapsible panels
export const NARROW_QUERY = '(max-width: 639px)';

export function useNarrow() {
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(NARROW_QUERY).matches
  );
  useEffect(() => {
    const mq = window.matchMedia(NARROW_QUERY);
    const onChange = () => setNarrow(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return narrow;
}
