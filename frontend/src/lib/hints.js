// ARG: the shadow layer — riddles never surface in the UI. The console gets
// one dry memory-leak line, strictly once per browser session (sessionStorage
// flag): after a 4+ minute session a 5% roll every minute, or a failed throw.
// Pool of 5: pi/leet/gargantua live forever in robots.txt, the echo header
// only ever shows Patmos/towel/bedroom — 7.77 and the 1987 oath are MEGA
// rare: console only, one shot per session. English + ASCII: the console,
// the source code and the HTTP headers are the hunting ground, not the
// screen. Collecting them all takes a community.
const KEY = 'void_mem_leak';
const FRAGMENTS = [
  ['0x0666', 'Open the Abyss with the mark the prophet John scratched on the rocks of the island of Patmos...'],
  ['0x7777', 'Call the holy triad of luck that makes the steel drums of Nevada fall silent...'],
  ['0x0042', 'Pay for the answer of 7.5 million years of supercomputer thinking, while you look for your towel...'],
  ['0xD057', 'Whisper the name of the one they left a gravity code of dust on the bedroom floor for...'],
  ['0x1987', 'Remember the oath of 1987 that the internet promised never to break...'],
];

const t0 = Date.now();
let printed = false;
let bag = [];

const leaked = () => {
  if (printed) return true;
  try {
    return !!sessionStorage.getItem(KEY);
  } catch {
    return false;
  }
};

const markLeaked = () => {
  printed = true;
  try {
    sessionStorage.setItem(KEY, '1');
  } catch {}
};

// one dry dump line, no styling: the kind of line you double-take at
export function emitVoidFragment(force) {
  if (!force && leaked()) return false;
  if (!bag.length) bag = FRAGMENTS.map((_, i) => i).sort(() => Math.random() - 0.5);
  const [addr, text] = FRAGMENTS[bag.pop()];
  console.log(`[VOID_CORE_MEM_LEAK]: Sector ${addr} read error. Chunk: "${text}"`);
  markLeaked();
  return true;
}

// rare condition: the session outlived a few minutes and the 5% roll hits.
// Once leaked, the flag in sessionStorage silences the core for the session.
// QA: window.__voidCore = { minMs, chance }, check()/emit(force)
export function initVoidCore() {
  if (typeof window === 'undefined') return;
  window.__voidCore = {
    minMs: 4 * 60 * 1000,
    chance: 0.05,
    emit: emitVoidFragment,
    check: () => {
      if (Date.now() - t0 < window.__voidCore.minMs) return false;
      if (Math.random() >= window.__voidCore.chance) return false;
      return emitVoidFragment();
    },
  };
  setInterval(() => window.__voidCore.check(), 60000);
}
