// 0.4 client store: narrow reads merged into one cached view (plan A4, H3).
//
// The screens read a view shaped like the 0.3 snapshot. It is assembled from
// governance, tasks, goals, hosting offers, the review feed, loaded messages
// and hosting summaries. Each part refreshes on its own; the cache shows the
// last known state at start-up, then only newer records are fetched.
const DAY_US = 86_400_000_000;
const CACHE_VERSION = 'rai.cache.v4.';
const CACHE_LIMIT = 3_500_000;
const MESSAGE_KEEP = 50;
export const month = us => new Date(us / 1000).toISOString().slice(0, 7);
export function monthsBetween(fromUs, toUs) {
  const out = [];
  const d = new Date(fromUs / 1000);
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  while (d.getTime() * 1000 <= toUs) {
    out.push(d.toISOString().slice(0, 7));
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return out;
}

/** @returns {{gov:any,tasks:any[],goals:any[],offers:any[],feed:any[],feedDay:number,messages:Record<string,any[]>,more:Record<string,boolean>,mine:{events:any[],invites:any[]},summaries:any[],summaryMonths:string[],updatedUs:number,govAt:number,summariesAt?:number}} */
export function emptyState() {
  return { gov: null, tasks: [], goals: [], offers: [], feed: [], feedDay: 0, messages: {}, more: {}, mine: { events: [], invites: [] }, summaries: [], summaryMonths: [], updatedUs: 0, govAt: 0 };
}

/** Merge by record hash, keeping time order. */
export function mergeEvents(...lists) {
  const map = new Map();
  for (const list of lists) for (const e of list ?? []) map.set(e.hash, e);
  return [...map.values()].sort((a, b) => a.timestamp_us - b.timestamp_us || (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0));
}

/** The view the screens read. Excluded joins are hidden with their records. */
export function viewOf(state) {
  if (!state.gov) return null;
  const excluded = new Set(state.gov.excluded_members);
  const members = state.gov.members.filter(m => !excluded.has(m.data.member_id));
  const allowed = new Set(members.map(m => m.hash));
  const messages = Object.values(state.messages).flat();
  const events = mergeEvents(state.gov.events, state.tasks, state.goals, state.offers, state.feed, state.mine.events, messages)
    .filter(e => allowed.has(e.data.membership));
  return { ...state.gov, members, events, summaries: state.summaries.filter(s => !excluded.has(s.member_id)), invites: state.mine.invites };
}

export function loadCache(storage, community) {
  try {
    const raw = storage.getItem(CACHE_VERSION + community);
    if (!raw) return emptyState();
    return { ...emptyState(), ...JSON.parse(raw) };
  } catch { return emptyState(); }
}
export function saveCache(storage, community, state) {
  try {
    const trimmed = { ...state, messages: Object.fromEntries(Object.entries(state.messages).map(([k, v]) => [k, v.slice(-MESSAGE_KEEP)])) };
    let text = JSON.stringify(trimmed);
    // Large communities keep governance, tasks and recent messages (plan H3); the rest refetches.
    if (text.length > CACHE_LIMIT) text = JSON.stringify({ ...trimmed, feed: [], feedDay: 0, summaries: [], summaryMonths: [] });
    if (text.length > CACHE_LIMIT) return false;
    storage.setItem(CACHE_VERSION + community, text);
    return true;
  } catch { return false; }
}

/** Channel id of a message body, from the channel versions in governance. */
export function channelOfMessage(gov, body) {
  if (!body?.channel) return 'general';
  const ch = gov?.events.find(e => e.hash === body.channel);
  return ch?.data.body.id ?? 'general';
}

/**
 * Refreshes the parts of `state` that `scope` asks for.
 * scope: { gov, tasks, goals, offers, feed, channels, channel, summaries, mine }
 */
export async function refreshState(api, community, state, scope, nowUs = Date.now() * 1000, memberId = '') {
  const next = { ...state };
  const jobs = [];
  if (scope.gov || !next.gov) jobs.push(api.governance(community).then(g => { next.gov = g; next.govAt = nowUs; }));
  if (scope.tasks) jobs.push(api.tasks(community).then(v => { next.tasks = v; }));
  if (scope.goals) jobs.push(api.goals(community).then(v => { next.goals = v; }));
  if (scope.offers) jobs.push(api.hostOffers(community).then(v => { next.offers = v; }));
  if (scope.mine && memberId) jobs.push(api.activity(community, memberId).then(v => { next.mine = v; }));
  await Promise.all(jobs);
  const gov = next.gov;
  if (scope.feed) {
    // Re-read from the day before the last fetched day: late records land in old buckets rarely.
    let from = next.feedDay ? next.feedDay - DAY_US : gov.created_us;
    const chunks = [];
    while (from <= nowUs) {
      const to = Math.min(nowUs, from + 399 * DAY_US);
      chunks.push(await api.feed(community, from, to));
      from = to + DAY_US;
    }
    next.feed = mergeEvents(next.feed, ...chunks);
    next.feedDay = nowUs - (nowUs % DAY_US);
  }
  if (scope.channel !== undefined) {
    const id = scope.channel;
    const known = next.messages[id] ?? [];
    const page = await api.messages(community, id === 'general' ? null : id, null, null, MESSAGE_KEEP);
    next.messages = { ...next.messages, [id]: mergeEvents(known, page.events) };
    next.more = { ...next.more, [id]: page.more || known.length > page.events.length };
  }
  if (scope.channels) {
    const latest = Math.max(0, ...Object.values(next.messages).flat().map(e => e.timestamp_us));
    const since = latest || nowUs - 2 * DAY_US;
    const fresh = await api.channelUpdates(community, since);
    const grouped = { ...next.messages };
    for (const e of fresh) {
      const id = channelOfMessage(gov, e.data.body);
      grouped[id] = mergeEvents(grouped[id] ?? [], [e]);
    }
    next.messages = grouped;
  }
  if (scope.summaries) {
    const hosts = [...new Set(next.offers.map(o => gov.members.find(m => m.hash === o.data.membership)?.data.member_id).filter(Boolean))];
    const months = monthsBetween(gov.created_us, nowUs);
    const current = month(nowUs);
    const previous = months.at(-2);
    const missing = months.filter(m => !next.summaryMonths.includes(m) || m === current || m === previous);
    const found = [];
    for (let i = 0; i < hosts.length; i += 100) {
      const ids = hosts.slice(i, i + 100);
      for (let j = 0; j < missing.length; j += 12) found.push(...await api.summaries(community, ids, missing.slice(j, j + 12)));
    }
    next.summaries = mergeEvents(next.summaries, found);
    next.summaryMonths = [...new Set([...next.summaryMonths, ...missing.filter(m => m !== current)])];
  }
  next.updatedUs = nowUs;
  return next;
}

/** Older messages for a channel (paging backwards). */
export async function olderMessages(api, community, state, id) {
  const known = state.messages[id] ?? [];
  const before = known[0]?.timestamp_us ?? null;
  const page = await api.messages(community, id === 'general' ? null : id, before, null, MESSAGE_KEEP);
  return { ...state, messages: { ...state.messages, [id]: mergeEvents(page.events, known) }, more: { ...state.more, [id]: page.more } };
}
