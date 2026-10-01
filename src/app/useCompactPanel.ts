import { useEffect, useState } from 'react';

const COMPACT_QUERY = '(max-width: 760px)';

function compactViewport(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.(COMPACT_QUERY).matches;
}

/** Panels start folded on phones and expanded on larger screens. */
export function useCompactPanel() {
  const [compact, setCompact] = useState(compactViewport);
  const [collapsed, setCollapsed] = useState(compactViewport);

  useEffect(() => {
    const query = window.matchMedia?.(COMPACT_QUERY);
    if (!query) return;
    const onChange = () => {
      setCompact(query.matches);
      setCollapsed(query.matches);
    };
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return { compact, collapsed, setCollapsed };
}
