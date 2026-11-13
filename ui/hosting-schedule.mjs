// Automatic, leaderless hosting checks (plan B2).
//
// Every checker computes the same order from shared records, so nobody assigns
// work. For each (host, UTC hour) the candidates are ranked by
// sha256(host || hour || checker) (rendezvous hashing). The hour has four
// 15-minute windows: rank 1 checks in window 1, rank 2 in window 2, rank 3 in
// window 3, and in window 4 any active checker may check a host that is still
// unverified ("last chance"). A covered hour is skipped.
export const HOUR_MS = 3_600_000;
export const WINDOW_MS = 15 * 60_000;
export const CONCURRENCY = 8;
export const TIMEOUT_MS = 5_000;
/** Checkers with a verified hour signed in the last 12 hours count as active. */
export const ACTIVE_MS = 12 * HOUR_MS;

const hex = buffer => Array.from(new Uint8Array(buffer), x => x.toString(16).padStart(2, '0')).join('');
export async function score(hostId, hourMs, checkerId) {
  const data = new TextEncoder().encode(`rai-community/rendezvous/v1\n${hostId}\n${hourMs}\n${checkerId}`);
  return hex(await crypto.subtle.digest('SHA-256', data));
}
export async function ranking(hostId, hourMs, candidates) {
  const scored = await Promise.all(candidates.filter(id => id !== hostId).map(async id => [await score(hostId, hourMs, id), id]));
  return scored.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([, id]) => id);
}
export const hourOf = ms => ms - (ms % HOUR_MS);
export const windowOf = ms => Math.min(3, Math.floor((ms % HOUR_MS) / WINDOW_MS));

/**
 * Candidate checkers: all authorized checkers, with recently active ones first.
 * When nobody was active (new community, night) every authorized checker counts.
 */
export function candidates(authorized, recentCheckers) {
  const active = authorized.filter(id => recentCheckers.has(id));
  return active.length ? active : authorized;
}

/**
 * Which hosts this checker should check now.
 * @param {{me:string, nowMs:number, hosts:{hostId:string,offer:string}[], authorized:string[], recent:Set<string>, covered:Set<string>, done:Set<string>}} input
 */
export async function dueTargets({ me, nowMs, hosts, authorized, recent, covered, done }) {
  const hour = hourOf(nowMs), window = windowOf(nowMs);
  const pool = candidates(authorized, recent);
  const out = [];
  for (const { hostId, offer } of hosts) {
    if (hostId === me) continue;
    const key = offer + '|' + hour;
    if (covered.has(key) || done.has(key)) continue;
    if (window === 3) {
      if (authorized.includes(me)) out.push({ hostId, offer, hour, window });
      continue;
    }
    const order = await ranking(hostId, hour, pool.includes(me) ? pool : [...pool, me]);
    // A checker outside the active pool still steps in when its rank comes up.
    if (order[window] === me) out.push({ hostId, offer, hour, window });
  }
  return out;
}

/** Runs `work` over `items` with bounded parallelism and a per-item timeout. */
export async function limited(items, work, concurrency = CONCURRENCY, timeoutMs = TIMEOUT_MS) {
  const results = [];
  let next = 0;
  async function lane() {
    while (next < items.length) {
      const item = items[next++];
      let timer;
      try {
        results.push(await Promise.race([work(item), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('timeout')), timeoutMs); })]));
      } catch (error) {
        results.push({ item, error: String(error?.message ?? error) });
      } finally { clearTimeout(timer); }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, lane));
  return results;
}

/**
 * Three shared records at least a day old, from different indexes, for the
 * storage check (plan C1).
 */
export function storageChallenge(snapshot, nowUs, random = Math.random) {
  const old = nowUs - 86_400_000_000;
  const kinds = new Map();
  for (const e of snapshot.events) {
    if (e.timestamp_us > old) continue;
    const t = e.data.body.type;
    const kind = t === 'task' ? 'tasks' : t === 'goal' ? 'goals' : t === 'message' ? 'messages'
      : ['claim', 'x_claim', 'flag', 'review', 'x_verify'].includes(t) ? 'activity' : t === 'host_offer' ? 'hosts' : 'governance';
    if (!kinds.has(kind)) kinds.set(kind, []);
    kinds.get(kind).push(e.hash);
  }
  const groups = [...kinds.values()].sort(() => random() - 0.5);
  const picked = [];
  for (const group of groups) {
    if (picked.length === 3) break;
    picked.push(group[Math.floor(random() * group.length)]);
  }
  // Fewer than three indexes: fill from what exists (the check then still needs three).
  const all = [...kinds.values()].flat().filter(h => !picked.includes(h));
  while (picked.length < 3 && all.length) picked.push(all.splice(Math.floor(random() * all.length), 1)[0]);
  return picked;
}

/** Attestations a host keeps until its next summary (plan G1: about every 6 hours). */
export const SUMMARY_EVERY_MS = 6 * HOUR_MS;
export function keepAttestation(list, proof) {
  if (list.some(p => p.hour_us === proof.hour_us && (p.full_copy || !proof.full_copy))) return list;
  return [...list.filter(p => p.hour_us !== proof.hour_us), proof].sort((a, b) => a.hour_us - b.hour_us);
}
export function summaryDue(list, lastPublishedMs, nowMs) {
  if (!list.length) return false;
  return nowMs - lastPublishedMs >= SUMMARY_EVERY_MS || list.length >= 72;
}
