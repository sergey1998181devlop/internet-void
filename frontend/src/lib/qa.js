// QA harness gate. The panel only exists for a link that carries the token
// (/?qa=<QA_TOKEN>): the token is parked in sessionStorage and the parameter
// is scrubbed from the address bar so it never rides along in screenshots or
// shared links. Every QA request then proves the token to the backend.
const KEY = 'void_qa';

try {
  const had = new URLSearchParams(window.location.search).get('qa');
  if (had) {
    sessionStorage.setItem(KEY, had);
    const u = new URL(window.location.href);
    u.searchParams.delete('qa');
    window.history.replaceState(null, '', u.pathname + u.search + u.hash);
  }
} catch {
  /* private mode: the panel simply stays off */
}

export const qaToken = () => {
  try {
    return sessionStorage.getItem(KEY) || '';
  } catch {
    return '';
  }
};

export const qaHeaders = () => {
  const t = qaToken();
  return t ? { 'X-QA-Token': t } : {};
};

let checked = null;

// one round trip on boot: only a live token turns the panel on
export async function qaPing() {
  if (checked !== null) return checked;
  const t = qaToken();
  if (!t) {
    checked = false;
    return checked;
  }
  try {
    const r = await fetch('/api/qa/ping', { headers: { 'X-QA-Token': t } });
    checked = r.ok;
  } catch {
    checked = false;
  }
  return checked;
}
