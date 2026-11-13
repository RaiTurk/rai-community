import test from 'node:test';
import assert from 'node:assert/strict';
import { displayName, nameTaken, shortId } from '../ui/names.mjs';
import { channelList, messageChannels, newChannelBody, channelBody, visibleGoals, GENERAL } from '../ui/channels.mjs';
import { ledger, balanceOf, balances, hostingHours, hoursInHostingMonth, monthlyHostingTargets, currentMultipliers, DEFAULT_MULTIPLIERS, lastFullCopy } from '../ui/raiunyt.mjs';
import { badgeCounts, badgeProgress, BADGES } from '../ui/badges.mjs';
import { adminPermissions, can, PERMISSIONS } from '../ui/core.mjs';
import { acceptedTerms, acceptTerms, termsText, termsChecks, TERMS_VERSION } from '../ui/terms.mjs';

const A = 'a1'.repeat(32), B = 'b2'.repeat(32), C = 'c3'.repeat(32), ORG = 'ff'.repeat(32);
const member = (hash, id, name) => ({ hash, data: { member_id: id, name, generation: 0 } });
const ev = (hash, membership, body, ts = 1) => ({ hash, data: { membership, body }, timestamp_us: ts, sequence: 1 });
const HOUR = 3_600_000_000;
const at = (h, m = 0) => Date.UTC(2026, 10, 12, h, m) * 1000;

test('equal display names are told apart, and taken names are refused case-insensitively', () => {
  const s = { community: { founder: ORG }, members: [member('uAAAA', A, 'Ayşe'), member('uAAAB', B, 'ayşe '), member('uAAAC', C, 'Mehmet')], events: [] };
  assert.equal(displayName(s, A), `Ayşe (${shortId(A)})`);
  assert.equal(displayName(s, C), 'Mehmet');
  assert.ok(nameTaken(s, 'AYŞE', null));
  assert.ok(nameTaken(s, '  mehmet ', A));
  assert.equal(nameTaken(s, 'Mehmet', C), false, 'own name is not a conflict');
});

test('organizer permissions: founder holds all, grants replace each other, empty grant revokes', () => {
  const s = { community: { founder: ORG }, members: [], events: [
    ev('g1', 'org', { type: 'admin_grant', member_id: A, permissions: ['tasks', 'channels'] }, 1),
    ev('g2', 'org', { type: 'admin_grant', member_id: B, permissions: ['hosting'] }, 2),
    ev('g3', 'org', { type: 'admin_grant', member_id: B, permissions: [] }, 3),
  ] };
  assert.deepEqual(adminPermissions(s, ORG), PERMISSIONS);
  assert.ok(can(s, A, 'tasks') && can(s, A, 'admin'));
  assert.equal(can(s, A, 'membership'), false);
  assert.equal(can(s, B, 'hosting'), false, 'the later empty grant revokes');
  assert.equal(can(s, B, 'admin'), false);
  assert.equal(can(s, C, 'admin'), false);
});

test('channels are their own records; latest version wins; messages resolve by channel version', () => {
  const body = newChannelBody('Duyurular', true);
  assert.match(body.id, /^[a-f0-9]{10}$/);
  assert.equal(body.type, 'channel');
  assert.equal(body.admins_only, true);
  const s = { members: [], events: [
    ev('h1', 'm', body, 10),
    ev('h2', 'm', { type: 'goal', id: 'g1', title: 'Real goal', archived: false }, 11),
    ev('h3', 'm', channelBody(body.id, 'Haberler', false, false), 12),
    ev('h4', 'm', channelBody(body.id, 'Haberler', false, true), 13),
  ] };
  assert.equal(channelList(s).length, 0, 'closed channel is hidden by default');
  const [c] = channelList(s, { includeClosed: true });
  assert.equal(c.name, 'Haberler');
  assert.equal(c.adminsOnly, false);
  assert.equal(c.closed, true);
  assert.equal(c.created, 10);
  const channelOf = messageChannels(s);
  assert.equal(channelOf({ channel: 'h1' }), body.id, 'a message on an older version still belongs to the channel');
  assert.equal(channelOf({ channel: null }), GENERAL);
  assert.deepEqual(visibleGoals(s).map(g => g.data.body.id), ['g1']);
  assert.throws(() => newChannelBody('  ', false));
  assert.throws(() => newChannelBody('x'.repeat(61), false));
});

// 0.4: verified hours arrive in signed hosting summaries; failed checks are never published.
const proof = (t, fullCopy = false, checker = 'mC') => ({ hour_us: t - (t % HOUR), observed_at_us: t, full_copy: fullCopy, checker, checker_authority: 'role', nonce: [], host_signature: [], checker_signature: [] });
function hostingSnapshot(extra = [], { full = false, summaries: more = [] } = {}) {
  // A and B host; C is a reviewer; ORG is founder.
  const summaries = [
    // 10:00 only A (×3); 11:00 A and B (×2 each); 12:00 A alone again (B did not answer) → ×3.
    { hash: 'sA', member_id: A, timestamp_us: at(18), data: { offer: 'offerA', membership: 'mA', hours: [proof(at(10, 5), full), proof(at(11, 10)), proof(at(12, 1), full)] } },
    // A's second device in the same hour must not double the hour.
    { hash: 'sA2', member_id: A, timestamp_us: at(18), data: { offer: 'offerA2', membership: 'mA2', hours: [proof(at(10, 30))] } },
    { hash: 'sB', member_id: B, timestamp_us: at(18), data: { offer: 'offerB', membership: 'mB', hours: [proof(at(11, 20))] } },
    // A checker cannot count its own hosting.
    { hash: 'self', member_id: C, timestamp_us: at(18), data: { offer: 'offerC', membership: 'mC', hours: [proof(at(10, 40))] } },
    ...more,
  ];
  return { community: { founder: ORG }, summaries, members: [member('mA', A, 'A'), member('mA2', A, 'A'), member('mB', B, 'B'), member('mC', C, 'C'), member('mO', ORG, 'Org')], events: [
    ev('role', 'mO', { type: 'peer_role', member_id: C, enabled: true }, 1),
    ev('offerA', 'mA', { type: 'host_offer', enabled: true }, 2),
    ev('offerA2', 'mA2', { type: 'host_offer', enabled: true }, 2),
    ev('offerB', 'mB', { type: 'host_offer', enabled: true }, 3),
    ...extra,
  ] };
}

test('full copy: +3 per verified full-copy hour, no scarcity bonus, network memory badges', () => {
  const s = hostingSnapshot([], { full: true });
  const entries = ledger(s);
  assert.equal(balanceOf(entries, A, 'hosting'), 8, 'hosting stays the same');
  assert.equal(balanceOf(entries, A, 'fullcopy'), 6, 'two full-copy hours × 3');
  assert.equal(balanceOf(entries, B, 'fullcopy'), 0);
  assert.ok(lastFullCopy(s, A) >= at(12, 1));
  assert.equal(badgeCounts(s, A).memory, 2);
  const progress = badgeProgress({ ...badgeCounts(s, A), memory: 55 });
  assert.deepEqual(progress.find(p => p.series === 'memory').earned, [10, 50]);
  assert.equal(progress.find(p => p.series === 'memory').next, 100);
  assert.deepEqual(BADGES.map(b => b.series), ['contribution', 'hosting', 'memory', 'invites']);
});

test('removed hosts earn no hosting hours', () => {
  const s = hostingSnapshot([ev('d', 'mO', { type: 'bulk_decision', member_ids: [B], removed: true, references: ['x'], reason: 'r' }, 5)]);
  assert.equal(hostingHours(s).filter(h => h.memberId === B).length, 0);
});

test('hosting: 1 RaiUnyt per verified hour per person, scarcity bonus by reachable hosts', () => {
  const s = hostingSnapshot();
  assert.deepEqual(currentMultipliers(s), DEFAULT_MULTIPLIERS);
  const hours = hostingHours(s);
  assert.equal(hours.filter(h => h.memberId === A).length, 3, 'three distinct hours, second device not double-counted');
  assert.deepEqual(hours.filter(h => h.memberId === A).map(h => h.multiplier), [3, 2, 3]);
  assert.deepEqual(hours.filter(h => h.memberId === B).map(h => h.multiplier), [2]);
  const entries = ledger(s);
  assert.equal(balanceOf(entries, A, 'hosting'), 8);
  assert.equal(balanceOf(entries, B, 'hosting'), 2);
  const day = entries.find(x => x.kind === 'hosting' && x.memberId === A);
  assert.equal(day.hours, 3);
  assert.equal(day.bonusHours, 3);
});

test('hosting policy changes apply from the time they are recorded', () => {
  // From 11:30 on, the organizer sets ×5 for a single host and ×1 for two hosts.
  const s = hostingSnapshot([ev('policy', 'mO', { type: 'hosting_policy', multipliers: [5, 1] }, at(11, 30))]);
  assert.deepEqual(currentMultipliers(s), [5, 1]);
  const a = hostingHours(s).filter(h => h.memberId === A).map(h => h.multiplier);
  // 10:00 hour ended before the change → ×3; 11:00 hour ends after it → two hosts ×1; 12:00 → ×5.
  assert.deepEqual(a, [3, 1, 5]);
});

test('monthly goals take the latest valid target for each member and month', () => {
  const target = (hash, membership, month, hours, timestamp) => ev(hash, membership, {
    type: 'module', module: 'hosting', version: 1, kind: 'monthly-target', admin: false,
    payload: JSON.stringify({ month, hours }),
  }, timestamp);
  const s = hostingSnapshot([
    target('old', 'mA', '2026-10', 60, Date.UTC(2026, 9, 31, 23) * 1000),
    target('a1', 'mA', '2026-11', 30, at(13)),
    target('b1', 'mB', '2026-11', 15, at(14)),
    target('a2', 'mA', '2026-11', 40, at(15)),
    target('b2', 'mB', '2026-11', 0, at(16)),
    target('invalid', 'mA', '2026-11', 721, at(17)),
    target('future', 'mA', '2026-12', 20, at(18)),
  ]);
  assert.equal(hoursInHostingMonth('2024-02'), 29 * 24);
  assert.deepEqual(monthlyHostingTargets(s), [
    { memberId: A, month: '2026-10', hours: 60 },
    { memberId: A, month: '2026-11', hours: 40 },
  ]);
});

test('campaign and hosting RaiUnyt are kept apart; linkless done tasks count once', () => {
  const s = hostingSnapshot([
    ev('t1', 'mO', { type: 'task', id: 'T1', title: 'One', post_url: 'https://x.com/a/status/1', actions: ['like'] }, 1),
    ev('t2', 'mO', { type: 'task', id: 'T2', title: 'Two', post_url: '', actions: ['done'] }, 1),
    ev('c1', 'mA', { type: 'claim', task: 't1', actions: ['like'], x_verification: 'x' }, 5),
    ev('c2', 'mA', { type: 'claim', task: 't2', actions: ['done'], x_verification: null, note: 'Shared with my class' }, 6),
    ev('c2b', 'mA', { type: 'claim', task: 't2', actions: ['done'], x_verification: null, note: '' }, 7),
  ]);
  const entries = ledger(s);
  assert.equal(balanceOf(entries, A, 'campaign'), 2);
  assert.equal(balanceOf(entries, A, 'hosting'), 8);
  assert.equal(balanceOf(entries, A), 10);
  assert.deepEqual(balances(entries).get(A), { campaign: 2, hosting: 8, fullcopy: 0 });
});

test('terms must be accepted for the current version', () => {
  const store = new Map(); const storage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  assert.equal(acceptedTerms(storage), null);
  acceptTerms(storage);
  assert.equal(acceptedTerms(storage).version, TERMS_VERSION);
  store.set('rai.terms', JSON.stringify({ version: 'old', acceptedAt: 'x' }));
  assert.equal(acceptedTerms(storage), null);
  assert.equal(termsText.tr.length, termsText.en.length);
  assert.equal(termsChecks.tr.length, termsChecks.en.length);
});
