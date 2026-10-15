// compliance strip for the game chrome: Terms / Privacy / Refunds + the 18+
// badge. Desktop keeps it in the free bottom-left corner; on phones the same
// links live in the burger menu (one floating panel at a time).
export default function LegalFooter() {
  return (
    <div
      data-shard
      className="pointer-events-none fixed bottom-2 left-3 z-20 hidden select-none items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-white/35 sm:flex"
    >
      <span className="rounded border border-white/20 px-1 py-px text-white/45">18+</span>
      <span className="text-white/25">© 2026 THE INTERNET VOID</span>
      <a href="/terms.html" className="pointer-events-auto transition hover:text-white/70">
        Terms
      </a>
      <a href="/privacy.html" className="pointer-events-auto transition hover:text-white/70">
        Privacy
      </a>
      <a href="/refund.html" className="pointer-events-auto transition hover:text-white/70">
        Refunds
      </a>
    </div>
  );
}
