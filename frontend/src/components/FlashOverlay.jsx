import { useEffect } from 'react';
import { useStore, clearFlash } from '../lib/store';

export default function FlashOverlay() {
  const { flash } = useStore();

  useEffect(() => {
    if (flash <= 0) return;
    const id = setTimeout(clearFlash, 400);
    return () => clearTimeout(id);
  }, [flash]);

  if (flash <= 0) return null;

  return (
    <div
      className="pointer-events-none absolute inset-0 z-40"
      style={{
        background:
          'radial-gradient(circle at 50% 50%, rgba(255,255,255,0.95) 0%, rgba(255,220,180,0.6) 35%, rgba(255,120,220,0.15) 70%, transparent 100%)',
        opacity: Math.min(1, flash),
        transition: 'opacity 120ms linear',
        mixBlendMode: 'screen',
      }}
    />
  );
}
