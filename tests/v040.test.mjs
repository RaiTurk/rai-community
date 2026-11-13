import test from 'node:test';
import assert from 'node:assert/strict';
import { ranking, dueTargets, windowOf, hourOf, candidates, storageChallenge, keepAttestation, summaryDue, limited, HOUR_MS, WINDOW_MS } from '../ui/hosting-schedule.mjs';
import { viewOf, mergeEvents, monthsBetween, emptyState, saveCache, loadCache, channelOfMessage } from '../ui/store.mjs';
import { formatInvite, parseInvite, removed } from '../ui/core.mjs';

const ids = ['a', 'b', 'c', 'd'].map(x => x.repeat(64));
const [HOST, C1, C2, C3] = ids;
const hour = Date.UTC(2026, 10, 12, 10) ;

test('rendezvous ranking is the same on every device and excludes the host', async () => {
  const one = await ranking(HOST, hour, [C1, C2, C3, HOST]);
  const two = await ranking(HOST, hour, [C3, C2, C1]);
  assert.deepEqual(one, two);
  assert.equal(one.includes(HOST), false);
  assert.notDeepEqual(await ranking(HOST, hour + HOUR_MS, [C1, C2, C3]), null);
});

test('windows hand the hour over: rank 1, 2, 3, then anyone; covered hours are skipped', async () => {
  const order = await ranking(HOST, hour, [C1, C2, C3]);
  const base = { hosts: [{ hostId: HOST, offer: 'offer' }], authorized: [C1, C2, C3], recent: new Set(), covered: new Set(), done: new Set() };
  for (let w = 0; w < 3; w++) {
    const now = hour + w * WINDOW_MS + 60_000;
    assert.equal(windowOf(now), w);
    for (const me of [C1, C2, C3]) {
      const due = await dueTargets({ ...base, me, nowMs: now });
      assert.equal(due.length, me === order[w] ? 1 : 0, `window ${w + 1} belongs to rank ${w + 1}`);
    }
  }
  const last = hour + 3 * WINDOW_MS + 60_000;
  for (const me of [C1, C2, C3]) assert.equal((await dueTargets({ ...base, me, nowMs: last })).length, 1, 'last chance: any checker');
  const covered = new Set(['offer|' + hour]);
  assert.equal((await dueTargets({ ...base, covered, me: order[1], nowMs: hour + WINDOW_MS + 1 })).length, 0);
  assert.equal((await dueTargets({ ...base, me: HOST, authorized: [HOST, C1], nowMs: last })).length, 0, 'a host never checks itself');
});

test('active checkers come first; with nobody active every authorized checker is a candidate', () => {
  assert.deepEqual(candidates([C1, C2, C3], new Set([C2])), [C2]);
  assert.deepEqual(candidates([C1, C2], new Set()), [C1, C2]);
  assert.equal(hourOf(hour + 1234), hour);
});

test('the storage check picks three day-old records from different indexes', () => {
  const now = Date.UTC(2026, 10, 12) * 1000;
  const old = now - 2 * 86_400_000_000;
  const ev = (hash, type, ts = old) => ({ hash, timestamp_us: ts, data: { body: { type } } });
  const s = { events: [ev('t', 'task'), ev('g', 'goal'), ev('m', 'message'), ev('c', 'claim'), ev('new', 'task', now)] };
  const picked = storageChallenge(s, now, () => 0.3);
  assert.equal(picked.length, 3);
  assert.equal(new Set(picked).size, 3);
  assert.equal(picked.includes('new'), false, 'records younger than a day are not used');
});

test('a host keeps one attestation per hour, preferring a full-copy one, and publishes about every 6 hours', () => {
  let kept = keepAttestation([], { hour_us: 1, full_copy: false });
  kept = keepAttestation(kept, { hour_us: 1, full_copy: true });
  kept = keepAttestation(kept, { hour_us: 1, full_copy: false });
  kept = keepAttestation(kept, { hour_us: 0, full_copy: false });
  assert.deepEqual(kept.map(p => [p.hour_us, p.full_copy]), [[0, false], [1, true]]);
  assert.equal(summaryDue([], 0, 1e13), false);
  assert.equal(summaryDue(kept, Date.now(), Date.now() + HOUR_MS), false);
  assert.equal(summaryDue(kept, Date.now(), Date.now() + 6 * HOUR_MS), true);
});

test('bounded parallel checks time out without blocking the rest', async () => {
  let running = 0, peak = 0;
  const results = await limited([1, 2, 3, 4, 5], async n => {
    running++; peak = Math.max(peak, running);
    await new Promise(r => setTimeout(r, n === 3 ? 200 : 5));
    running--;
    return n;
  }, 2, 50);
  assert.equal(peak, 2);
  assert.equal(results.filter(r => r?.error === 'timeout').length, 1);
});

test('the cached view merges narrow reads and hides members whose join is not valid', () => {
  const m = (hash, id) => ({ hash, data: { member_id: id }, timestamp_us: 1 });
  const e = (hash, membership, type, ts) => ({ hash, timestamp_us: ts, data: { membership, body: { type } } });
  const state = { ...emptyState(), gov: { community: { founder: 'f' }, members: [m('mf', 'f'), m('mx', 'x')], excluded_members: ['x'], joins: [], events: [e('g', 'mf', 'channel', 2)] },
    tasks: [e('t', 'mf', 'task', 1)], messages: { general: [e('ok', 'mf', 'message', 3), e('spam', 'mx', 'message', 4)] }, summaries: [{ hash: 's', member_id: 'x', data: { hours: [] } }] };
  const view = viewOf(state);
  assert.deepEqual(view.members.map(x => x.hash), ['mf']);
  assert.deepEqual(view.events.map(x => x.hash), ['t', 'g', 'ok']);
  assert.equal(view.summaries.length, 0);
  assert.deepEqual(mergeEvents([e('a', 'm', 'x', 2)], [e('a', 'm', 'x', 2), e('b', 'm', 'x', 1)]).map(x => x.hash), ['b', 'a']);
  assert.deepEqual(monthsBetween(Date.UTC(2026, 9, 31) * 1000, Date.UTC(2026, 11, 1) * 1000), ['2026-10', '2026-11', '2026-12']);
  assert.equal(channelOfMessage(state.gov, { channel: null }), 'general');
});

test('the cache survives a restart and fails closed when storage is unavailable', () => {
  const store = new Map();
  const storage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const state = { ...emptyState(), gov: { community: { founder: 'f' } }, govAt: 5 };
  assert.equal(saveCache(storage, 'c', state), true);
  assert.equal(loadCache(storage, 'c').govAt, 5);
  const broken = { getItem: () => { throw Error('blocked'); }, setItem: () => { throw Error('blocked'); } };
  assert.equal(saveCache(broken, 'c', state), false);
  assert.deepEqual(loadCache(broken, 'c'), emptyState());
});

test('invitation codes carry the community and the invitation', () => {
  const a = 'uhCkk' + 'A'.repeat(48), b = 'uhCkk' + 'B'.repeat(48);
  assert.deepEqual(parseInvite(`Join us: ${formatInvite(a, b)} `), { community: a, invitation: b });
  assert.throws(() => parseInvite('RAI-INVITE.uhCkkX.uhCkkY'));
});

test('a combined decision removes every listed member', () => {
  const s = { community: { founder: 'f' }, members: [], events: [{ hash: 'd', data: { membership: 'mf', body: { type: 'bulk_decision', member_ids: ['x', 'y'], removed: true } } }] };
  assert.equal(removed(s, 'x'), true);
  assert.equal(removed(s, 'y'), true);
  assert.equal(removed(s, 'z'), false);
});
