import { contributionGroups, eligibleEvent, memberFor, removed } from './core.mjs';

// RaiUnyt accrual, rules v3 (0.4 network). Read-only: every amount is derived
// from public community records that any member can recompute. Nothing is
// minted, sent or stored as a balance, and nobody (including the organizer)
// can write one. Non-transferable recognition score; no monetary value.
//
// Campaigns and hosting are reported separately (they are different kinds of work).
export const RULES_VERSION = 'raiunyt-rules-v3';
export const CAMPAIGN_AMOUNT = 1;
export const HOSTING_HOURLY = 1;
/** A verified full-copy hour earns this on top of the hosting hour; no scarcity bonus (RaiTurk, 2026-11-12). */
export const FULL_COPY_HOURLY = 3;
/** Scarcity bonus: index 0 = one reachable host in that hour, index 1 = two; more hosts earn ×1. */
export const DEFAULT_MULTIPLIERS = [3, 2];
const HOUR_US = 3_600_000_000;

const day = timestampUs => new Date(timestampUs / 1000).toISOString().slice(0, 10);
const round = n => Math.round(n * 100) / 100;

/** Multipliers in force at a moment: the latest hosting policy recorded before it. */
export function multipliersAt(snapshot, timestampUs) {
  let current = DEFAULT_MULTIPLIERS;
  for (const event of snapshot.events)
    if (event.data.body.type === 'hosting_policy' && event.timestamp_us <= timestampUs) current = event.data.body.multipliers;
  return current;
}
export const currentMultipliers = snapshot => multipliersAt(snapshot, Number.MAX_SAFE_INTEGER);
export const multiplierFor = (multipliers, hosts) => multipliers[hosts - 1] ?? 1;

/**
 * 0.4: verified hours come from signed hosting summaries. Each hour carries the
 * host device's signature and an authorized checker's signature; the network
 * validated both before the summary was stored.
 */
export function hostingObservations(snapshot) {
  const binding = new Map(snapshot.members.map(m => [m.hash, m.data.member_id]));
  const checks = [];
  for (const summary of snapshot.summaries ?? []) {
    for (const proof of summary.data.hours) {
      const observer = binding.get(proof.checker);
      if (!observer || observer === summary.member_id) continue;
      checks.push({ offer: summary.data.offer, host: summary.member_id, observer, time: proof.observed_at_us,
        hour: proof.hour_us, success: true, fullCopy: !!proof.full_copy });
    }
  }
  return checks;
}

/**
 * Verified hosting hours: an hour counts once per member when a signed check
 * reached their device in that hour. Full-copy hours earn a separate +3.
 */
export function hostingHours(snapshot) {
  const hours = new Map();
  for (const check of hostingObservations(snapshot)) {
    if (removed(snapshot, check.host)) continue;
    const hour = check.hour ?? Math.floor(check.time / HOUR_US) * HOUR_US;
    if (!hours.has(hour)) hours.set(hour, new Map());
    const hosts = hours.get(hour);
    hosts.set(check.host, (hosts.get(check.host) ?? false) || check.fullCopy);
  }
  const out = [];
  const policies = snapshot.events.filter(event => event.data.body.type === 'hosting_policy');
  for (const [hour, hosts] of hours) {
    const policy = policies.findLast(event => event.timestamp_us < hour + HOUR_US);
    const multiplier = multiplierFor(policy?.data.body.multipliers ?? DEFAULT_MULTIPLIERS, hosts.size);
    for (const [memberId, fullCopy] of hosts)
      out.push({ memberId, hour, hosts: hosts.size, multiplier, amount: HOSTING_HOURLY * multiplier, fullCopy });
  }
  return out.sort((a, b) => a.hour - b.hour);
}

/** The latest verified full-copy hour of a member, or 0. */
export function lastFullCopy(snapshot, memberId) {
  let last = 0;
  for (const check of hostingObservations(snapshot)) if (check.host === memberId && check.fullCopy) last = Math.max(last, check.time);
  return last;
}

export const hostingMonth = (timestampUs = Date.now() * 1000) => day(timestampUs).slice(0, 7);

export function hoursInHostingMonth(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return 0;
  const date = new Date(month + '-01T00:00:00Z');
  date.setUTCMonth(date.getUTCMonth() + 1, 0);
  return date.getUTCDate() * 24;
}

export function monthlyHostingTargets(snapshot) {
  const targets = new Map();
  for (const event of snapshot.events) {
    const { body } = event.data;
    if (body.type !== 'module' || body.module !== 'hosting' || body.version !== 1
      || body.kind !== 'monthly-target' || body.admin !== false || !eligibleEvent(snapshot, event)) continue;
    let target;
    try { target = JSON.parse(body.payload); } catch { continue; }
    if (!target || typeof target.month !== 'string' || !Number.isInteger(target.hours)
      || target.month !== hostingMonth(event.timestamp_us)
      || target.hours < 0 || target.hours > hoursInHostingMonth(target.month)) continue;
    const memberId = memberFor(snapshot, event).data.member_id;
    const key = memberId + '|' + target.month;
    if (target.hours) targets.set(key, { memberId, month: target.month, hours: target.hours });
    else targets.delete(key);
  }
  return [...targets.values()];
}

export function ledger(snapshot, language) {
  const entries = [];
  const events = new Map(snapshot.events.map(event => [event.hash, event]));

  // Campaigns: one amount per member and campaign, however many actions/devices.
  const reviews = new Map();
  for (const event of snapshot.events) {
    const body = event.data.body;
    if (body.type === 'review' && eligibleEvent(snapshot, event)) reviews.set(body.claim, body.outcome);
  }
  for (const group of contributionGroups(snapshot, language)) {
    if (group.removed) continue;
    const outcomes = group.references.map(ref => reviews.get(ref)).filter(Boolean);
    const disputed = outcomes.at(-1) === 'conflict';
    const first = events.get(group.references[0]);
    entries.push({
      memberId: group.memberId, kind: 'campaign', source: group.taskId, title: group.title,
      date: first ? day(first.timestamp_us) : '', timestampUs: first?.timestamp_us ?? 0,
      amount: disputed ? 0 : CAMPAIGN_AMOUNT, basis: disputed ? 'conflict' : outcomes.at(-1) === 'supported' ? 'supported' : 'reported',
      rule: RULES_VERSION,
    });
  }

  // Hosting: one row per member and UTC day, summing verified hours with their scarcity bonus.
  const perDay = new Map();
  for (const h of hostingHours(snapshot)) {
    const key = h.memberId + '|' + day(h.hour);
    const item = perDay.get(key) ?? { memberId: h.memberId, date: day(h.hour), hours: 0, bonusHours: 0, fullCopyHours: 0, amount: 0, timestampUs: h.hour };
    item.hours += 1;
    if (h.fullCopy) item.fullCopyHours += 1;
    if (h.multiplier > 1) item.bonusHours += 1;
    item.amount += h.amount;
    item.timestampUs = Math.max(item.timestampUs, h.hour);
    perDay.set(key, item);
  }
  for (const item of perDay.values()) {
    entries.push({
      memberId: item.memberId, kind: 'hosting', source: item.date, title: String(item.hours),
      hours: item.hours, bonusHours: item.bonusHours,
      date: item.date, timestampUs: item.timestampUs, amount: round(item.amount),
      basis: 'peer-checks', rule: RULES_VERSION,
    });
    if (item.fullCopyHours) entries.push({
      memberId: item.memberId, kind: 'fullcopy', source: item.date, title: String(item.fullCopyHours),
      hours: item.fullCopyHours, date: item.date, timestampUs: item.timestampUs,
      amount: FULL_COPY_HOURLY * item.fullCopyHours, basis: 'storage-checks', rule: RULES_VERSION,
    });
  }
  return entries.sort((a, b) => b.timestampUs - a.timestampUs);
}

/** Per member: { campaign, hosting, fullcopy } totals. */
export function balances(entries) {
  const map = new Map();
  for (const entry of entries) {
    const item = map.get(entry.memberId) ?? { campaign: 0, hosting: 0, fullcopy: 0 };
    item[entry.kind] = round(item[entry.kind] + entry.amount);
    map.set(entry.memberId, item);
  }
  return map;
}

export const balanceOf = (entries, memberId, kind) => round(entries.filter(e => e.memberId === memberId && (!kind || e.kind === kind)).reduce((sum, e) => sum + e.amount, 0));
